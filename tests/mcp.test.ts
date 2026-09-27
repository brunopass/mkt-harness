import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, describe, expect, it } from "vitest";
import { makeWs, ROOT } from "./helpers.js";

async function connect(ws: string, env: Record<string, string> = {}) {
  const cfg = path.join(ws, "mkt.config.yaml");
  fs.writeFileSync(cfg, "quietHours: null\n");
  const transport = new StdioClientTransport({
    command: path.join(ROOT, "bin", "mkt"),
    args: ["mcp"],
    env: { ...(process.env as Record<string, string>), MKT_WORKSPACE: ws, MKT_CONFIG: cfg, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

const text = (r: any) => r.content.map((c: any) => c.text ?? "").join("");

describe("mcp server", () => {
  const clients: Client[] = [];
  afterAll(async () => {
    for (const c of clients) await c.close();
  });

  it("exposes the full toolset and runs a draft -> list flow; agents cannot approve", async () => {
    const ctx = makeWs();
    const client = await connect(ctx.ws);
    clients.push(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["brand_context", "content_create", "lead_upsert", "outbox_draft", "outbox_dispatch", "outbox_claim", "inbox_sync", "trend_momentum", "browser_click", "browser_snapshot", "suppress"])
      expect(names).toContain(n);

    expect(text(await client.callTool({ name: "brand_list", arguments: {} }))).toMatch(/acme-ig/);
    const pack = text(await client.callTool({ name: "brand_context", arguments: { brand: "acme", persona: "founder" } }));
    expect(pack).toMatch(/Direct, warm/);

    const lead = JSON.parse(text(await client.callTool({ name: "lead_upsert", arguments: { brand: "acme", name: "Jane", handles: { linkedin: "jane-doe" }, source: { kind: "test" } } })));
    const draft = JSON.parse(text(await client.callTool({ name: "outbox_draft", arguments: { brand: "acme", kind: "connect", account: "acme-li", to: { leadId: lead.lead.id }, body: "Hi Jane", rationale: "test" } })));
    expect(draft.status).toBe("pending_approval");

    const denied = await client.callTool({ name: "outbox_approve", arguments: { ids: [draft.id] } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toMatch(/cannot approve/);

    const list = JSON.parse(text(await client.callTool({ name: "outbox_list", arguments: { brand: "acme", status: ["pending_approval"] } })));
    expect(list.map((i: any) => i.id)).toEqual([draft.id]);

    const bad = await client.callTool({ name: "outbox_draft", arguments: { brand: "acme", kind: "dm", account: "nope", body: "x", to: { handle: "a" } } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/unknown account/);
  });

  it("headless profile drops sending and browser input tools", async () => {
    const ctx = makeWs();
    const client = await connect(ctx.ws, { MKT_MCP_PROFILE: "headless" });
    clients.push(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("outbox_draft");
    expect(names).toContain("browser_snapshot");
    for (const n of ["outbox_dispatch", "outbox_claim", "outbox_complete", "browser_click", "browser_type", "browser_upload"]) expect(names).not.toContain(n);
  });
});
