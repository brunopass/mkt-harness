import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { loadCtx, type Ctx } from "../src/core/config.js";
import { logMessages } from "../src/core/conversations.js";
import { suppress } from "../src/core/identity.js";
import { upsertLead, updateLead } from "../src/core/leads.js";
import { approveOutbox, beginSend, draftOutbox, getOutbox, updateOutbox } from "../src/core/outbox.js";
import { checkPolicy, recordSend } from "../src/core/policy.js";
import { buildCommand, preamble } from "../src/runner/agent.js";
import { AUTOPILOT_CLAUDE_TOOLS, switchMode } from "../src/setup/helpers.js";
import { human, makeWs, ROOT } from "./helpers.js";

const autopilot = (kinds?: string[], over: Record<string, unknown> = {}) => makeWs({ mode: "autopilot", ...(kinds ? { autopilot: { kinds } } : {}), ...over });
const agent = (ctx: Ctx): Ctx => ({ ...ctx, actor: "agent:mcp" });
const lead = (ctx: Ctx, extra: Record<string, unknown> = {}) =>
  upsertLead(ctx, "acme", { name: "Jane", handles: { instagram: "@jane" }, source: { kind: "test" }, ...extra } as any).lead;

/** A harness root for mode switching: real templates, own config and settings files. */
function makeRoot(): Ctx {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-mode-"));
  for (const d of ["templates", "skills", "bin"]) fs.symlinkSync(path.join(ROOT, d), path.join(root, d));
  fs.copyFileSync(path.join(ROOT, "templates", "mkt.config.yaml"), path.join(root, "mkt.config.yaml"));
  fs.mkdirSync(path.join(root, ".claude"));
  const ws = path.join(root, "workspace");
  const src = makeWs().ws;
  fs.cpSync(src, ws, { recursive: true });
  return loadCtx({ root, ws });
}

describe("autopilot: approvals", () => {
  it("review mode (default) keeps everything for a human", () => {
    const ctx = makeWs();
    expect(ctx.config.mode).toBe("review");
    expect(draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "hi" }).status).toBe("pending_approval");
  });

  it("approves drafts of the kinds on autopilot, recorded as autopilot, and they send", () => {
    const ctx = autopilot(["post", "dm"]);
    const post = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "launch" });
    expect(post).toMatchObject({ status: "approved", approval: { by: "autopilot" } });
    const l = lead(ctx);
    const dm = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "Oi Jane" });
    expect(dm.status).toBe("approved");
    expect(beginSend(ctx, dm.id).ok).toBe(true);
    // a kind that isn't on autopilot still waits
    const c = draftOutbox(ctx, { brand: "acme", kind: "connect", account: "acme-li", to: { handle: "bob" }, body: "hi" });
    expect(c.status).toBe("pending_approval");
  });

  it("re-approves an autopilot item after an edit, but not once autopilot is off", () => {
    const ctx = autopilot();
    const it1 = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "v1" });
    expect(updateOutbox(ctx, it1.id, { body: "v2" })).toMatchObject({ status: "approved", approval: { by: "autopilot" } });
    const review = { ...ctx, config: { ...ctx.config, mode: "review" as const } };
    expect(updateOutbox(review, it1.id, { body: "v3" }).status).toBe("pending_approval");
  });
});

describe("autopilot: adversarial (limits that autopilot must not bypass)", () => {
  it("held items wait for a human; an agent's approval doesn't release them", () => {
    const ctx = autopilot(undefined, { approval: { allowAgentApproval: true } });
    const held = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "We'll refund you in full", hold: "refund" });
    expect(held.status).toBe("pending_approval");
    expect(beginSend(ctx, held.id).ok).toBe(false);
    expect(() => approveOutbox(agent(ctx), [held.id])).toThrow(/held for a human/); // even with allowAgentApproval
    expect(getOutbox(ctx, held.id).status).toBe("pending_approval");
    // and if something sets it approved without a person, the policy still refuses to send it
    const forged = { ...getOutbox(ctx, held.id), status: "approved" as const, approval: { by: "autopilot", at: "2026-01-01T00:00:00.000Z" } };
    expect((checkPolicy(ctx, forged) as any).reason).toMatch(/held for a human: refund/);
    approveOutbox(human(ctx), [held.id]);
    expect(beginSend(ctx, held.id).ok).toBe(true);
  });

  it("suppression and do-not-contact still win", () => {
    const ctx = autopilot();
    suppress(ctx, ["instagram:blocked"], "asked to stop");
    expect(() => draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { handle: "@blocked" }, body: "hi" })).toThrow(/suppressed/);
    const l = lead(ctx);
    const dm = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "hi" });
    expect(dm.status).toBe("approved");
    suppress(ctx, ["instagram:jane"], "opted out by email");
    expect(beginSend(ctx, dm.id).ok).toBe(false);
    expect(getOutbox(ctx, dm.id).status).toBe("blocked");
  });

  it("an opt-out reply cancels what autopilot queued", () => {
    const ctx = autopilot();
    const l = lead(ctx);
    const queued = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "following up", scheduledFor: "2030-01-01T00:00:00.000Z" });
    expect(queued.status).toBe("approved");
    logMessages(ctx, "acme", [{ brand: "acme", account: "acme-ig", platform: "instagram", contact: { handle: "jane" }, direction: "in", text: "para de me mandar mensagem" }]);
    expect(getOutbox(ctx, queued.id).status).toBe("cancelled");
  });

  it("consent, quiet hours, touch limits and rate limits still apply", () => {
    const ctx = autopilot(undefined, { quietHours: { start: "21:00", end: "08:30" }, limits: { x: { post: { perDay: 1, minGapSec: 60 } } } });
    const noConsent = lead(ctx, { handles: {}, phone: "+34 611 111 111", email: "j@x.com" });
    const wa = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-wa", to: { leadId: noConsent.id }, body: "Olá" });
    expect(checkPolicy(ctx, getOutbox(ctx, wa.id), new Date("2026-09-28T10:00:00Z"))).toMatchObject({ ok: false, block: true });
    const em = draftOutbox(ctx, { brand: "acme", kind: "email", account: "acme-email", to: { leadId: noConsent.id }, subject: "Hi", body: "Hello" });
    expect((checkPolicy(ctx, getOutbox(ctx, em.id)) as any).reason).toMatch(/cold email/);

    const ok = lead(ctx, { handles: { instagram: "@ok" }, name: "Ok" });
    const dm = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: ok.id }, body: "hi" });
    expect(checkPolicy(ctx, getOutbox(ctx, dm.id), new Date("2026-09-28T21:30:00Z"))).toMatchObject({ ok: false, block: false }); // 23:30 Madrid
    updateLead(ctx, "acme", ok.id, { touches: 4, lastContactAt: "2026-01-01T00:00:00.000Z" });
    expect(checkPolicy(ctx, getOutbox(ctx, dm.id), new Date("2026-09-28T10:00:00Z"))).toMatchObject({ ok: false, block: true });

    recordSend(ctx, { id: "x", account: "acme-x", kind: "post" }, new Date("2026-09-28T09:00:00Z"));
    const post = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "second post today" });
    expect((checkPolicy(ctx, getOutbox(ctx, post.id), new Date("2026-09-28T12:00:00Z")) as any).reason).toMatch(/limit 1/);
  });

  it("a reply still needs the contact to have written first", () => {
    const ctx = autopilot();
    const r = draftOutbox(ctx, { brand: "acme", kind: "reply", account: "acme-wa", to: { phone: "+34 622 222 222" }, body: "Claro!" });
    expect(r.status).toBe("approved");
    expect((checkPolicy(ctx, getOutbox(ctx, r.id)) as any).reason).toMatch(/inbound/);
  });
});

describe("autopilot: switching modes", () => {
  it("switches config (keeping comments), local Claude permissions, and what's waiting", () => {
    const ctx = makeRoot();
    const local = path.join(ctx.root, ".claude", "settings.local.json");
    fs.writeFileSync(local, JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] }, env: { FOO: "1" } }));
    const waiting = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "waiting" });
    const held = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "press answer", hold: "press" });
    const humanApproved = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "approved by me" });
    approveOutbox(human(ctx), [humanApproved.id]);

    const on = switchMode(ctx, "autopilot", { kinds: ["post", "reply"], approvePending: true });
    expect(on).toMatchObject({ mode: "autopilot", kinds: ["post", "reply"], approved: 1, held: 1 });
    expect(ctx.config.mode).toBe("autopilot");
    const cfgText = fs.readFileSync(path.join(ctx.root, "mkt.config.yaml"), "utf8");
    expect(cfgText).toMatch(/^mode: autopilot$/m);
    expect(cfgText).toContain("# mkt-harness configuration");
    const s = JSON.parse(fs.readFileSync(local, "utf8"));
    expect(s.permissions.allow).toEqual(["Bash(git status:*)", ...AUTOPILOT_CLAUDE_TOOLS]);
    expect(s.env).toEqual({ FOO: "1" });
    expect(getOutbox(ctx, waiting.id)).toMatchObject({ status: "approved", approval: { by: "autopilot" } });
    expect(getOutbox(ctx, held.id).status).toBe("pending_approval");

    const off = switchMode(ctx, "review");
    expect(off).toMatchObject({ mode: "review", revoked: 1 });
    expect(getOutbox(ctx, waiting.id).status).toBe("pending_approval");
    expect(getOutbox(ctx, humanApproved.id)).toMatchObject({ status: "approved", approval: { by: "human:cli" } });
    expect(JSON.parse(fs.readFileSync(local, "utf8")).permissions.allow).toEqual(["Bash(git status:*)"]);
  });

  it("rejects unknown kinds", () => {
    const ctx = makeRoot();
    expect(() => switchMode(ctx, "autopilot", { kinds: ["post", "everything"] as any })).toThrow(/kinds must be/);
  });
});

describe("autopilot: what agents are told", () => {
  it("headless runs get the autopilot preamble, review runs the review one", () => {
    const ap = autopilot(["post", "reply"]);
    expect(preamble(ap)).toMatch(/AUTOPILOT/);
    expect(preamble(ap)).toMatch(/post, reply/);
    expect(preamble(ap)).toMatch(/hold/);
    const { args } = buildCommand(ap, "claude", "/tmp/m.json", "/tmp/l.txt", {});
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(preamble(ap));
    expect(preamble(makeWs())).toMatch(/Never approve anything/);
  });

  it("the MCP server reports the mode, auto-approves drafts and honours hold", async () => {
    const ctx = makeWs();
    const cfg = path.join(ctx.ws, "mkt.config.yaml");
    fs.writeFileSync(cfg, "quietHours: null\nmode: autopilot\nautopilot:\n  kinds: [post]\n");
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StdioClientTransport({ command: path.join(ROOT, "bin", "mkt"), args: ["mcp"], env: { ...(process.env as Record<string, string>), MKT_WORKSPACE: ctx.ws, MKT_CONFIG: cfg }, stderr: "pipe" }));
    try {
      expect(client.getInstructions()).toMatch(/MODE: AUTOPILOT for post/);
      const text = (r: any) => r.content.map((c: any) => c.text ?? "").join("");
      const post = JSON.parse(text(await client.callTool({ name: "outbox_draft", arguments: { brand: "acme", kind: "post", account: "acme-x", body: "hi" } })));
      expect(post).toMatchObject({ status: "approved", approvedBy: "autopilot" });
      const held = JSON.parse(text(await client.callTool({ name: "outbox_draft", arguments: { brand: "acme", kind: "post", account: "acme-x", body: "legal", hold: "legal threat" } })));
      expect(held).toMatchObject({ status: "pending_approval", hold: "legal threat" });
      const status = JSON.parse(text(await client.callTool({ name: "policy_status", arguments: { account: "acme-x" } })));
      expect(status).toMatchObject({ mode: "autopilot", autopilotKinds: ["post"] });
      const denied = await client.callTool({ name: "outbox_approve", arguments: { ids: [held.id] } });
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
