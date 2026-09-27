import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { listAccounts } from "../src/core/brands.js";
import { loadCtx, type Ctx } from "../src/core/config.js";
import { enableRoutines, envName, upsertEnv, withAuth } from "../src/setup/helpers.js";
import { Cancelled, type Choice, type Prompter } from "../src/setup/prompter.js";
import { runSetup, type SetupDeps } from "../src/setup/tui.js";
import { ROOT } from "./helpers.js";

/** A throwaway harness root: real templates/skills/bin, fresh config and workspace. */
function makeRoot(): Ctx {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-setup-"));
  for (const d of ["templates", "skills", "bin"]) fs.symlinkSync(path.join(ROOT, d), path.join(root, d));
  return loadCtx({ root, ws: path.join(root, "workspace") });
}

type Answer = { q: RegExp; a: unknown };

/** Answers prompts in order and fails loudly when the flow asks something unexpected. */
class ScriptedPrompter implements Prompter {
  shown: string[] = [];
  asked: string[] = [];
  constructor(private answers: Answer[]) {}
  private next(kind: string, message: string, options?: Choice<unknown>[]): any {
    this.asked.push(`${kind}: ${message}`);
    const a = this.answers.shift();
    if (!a) throw new Cancelled();
    if (!a.q.test(message)) throw new Error(`expected a prompt matching ${a.q}, got ${kind} "${message}"`);
    if (options) {
      const values = options.map((o) => o.value);
      for (const v of Array.isArray(a.a) ? a.a : [a.a]) if (!values.includes(v)) throw new Error(`"${String(v)}" is not an option of "${message}": ${values.join(", ")}`);
    }
    return a.a;
  }
  intro = (t: string) => void this.shown.push(t);
  outro = (t: string) => void this.shown.push(t);
  note = (b: string, t?: string) => void this.shown.push(`${t ?? ""}\n${b}`);
  info = (m: string) => void this.shown.push(m);
  success = (m: string) => void this.shown.push(m);
  warn = (m: string) => void this.shown.push(m);
  async text(o: { message: string; validate?: (v: string) => string | undefined }) {
    const v = this.next("text", o.message) as string;
    const err = v && o.validate?.(v);
    if (err) throw new Error(`validation failed for "${o.message}": ${err}`);
    return v;
  }
  async password(o: { message: string }) {
    return this.next("password", o.message) as string;
  }
  async confirm(o: { message: string }) {
    return this.next("confirm", o.message) as boolean;
  }
  async select<T>(o: { message: string; options: Choice<T>[] }) {
    return this.next("select", o.message, o.options as Choice<unknown>[]) as T;
  }
  async multiselect<T>(o: { message: string; options: Choice<T>[] }) {
    return this.next("multiselect", o.message, o.options as Choice<unknown>[]) as T[];
  }
  async spin<T>(_m: string, work: () => Promise<T>) {
    return work();
  }
}

function fakeDeps(over: Partial<SetupDeps> = {}) {
  const calls: string[] = [];
  let loginChecks = 0;
  const deps: SetupDeps = {
    detectTools: () => ({ checks: [{ name: "Node.js", ok: true, detail: "22" }, { name: "Google Chrome", ok: true, detail: "/chrome" }], engines: ["claude", "codex"] }),
    openForLogin: async (_c, id) => void calls.push(`open ${id}`),
    checkLogin: async (_c, id) => {
      calls.push(`check ${id}`);
      return ++loginChecks > 1; // the first check fails, the second succeeds
    },
    closeBrowser: async (_c, id) => void calls.push(`close ${id}`),
    verifySmtp: async (url) => void calls.push(`smtp ${url}`),
    installDaemon: async () => (calls.push("daemon"), "installed"),
    launchAgent: async (_c, engine, prompt) => void calls.push(`launch ${engine} ${prompt}`),
    platform: "darwin",
    ...over,
  };
  return { deps, calls };
}

describe("setup helpers", () => {
  it("upserts .env keys, keeps other lines and makes the file private", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mkt-env-")), ".env");
    fs.writeFileSync(f, "# secrets\nOTHER=1\nMKT_SMTP_A=old\n");
    upsertEnv(f, { MKT_SMTP_A: "smtps://a%40b.c:p%40ss@h:465", MKT_NEW: "has space" });
    expect(fs.readFileSync(f, "utf8")).toBe('# secrets\nOTHER=1\nMKT_SMTP_A=smtps://a%40b.c:p%40ss@h:465\nMKT_NEW="has space"\n');
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(process.env.MKT_NEW).toBe("has space");
  });

  it("builds env names and authenticated mail URLs", () => {
    expect(envName("SMTP", "acme-email")).toBe("MKT_SMTP_ACME_EMAIL");
    expect(withAuth("smtps://smtp.gmail.com:465", "hello@acme.com", "p@ss word:/")).toBe("smtps://hello%40acme.com:p%40ss%20word%3A%2F@smtp.gmail.com:465");
  });

  it("enables routines per brand, copying one already used by another brand, and keeps comments", () => {
    const ctx = makeRoot();
    fs.copyFileSync(path.join(ROOT, "templates", "mkt.config.yaml"), path.join(ctx.root, "mkt.config.yaml"));
    expect(enableRoutines(ctx, "acme", ["trend-radar"])).toEqual(["trend-radar"]);
    expect(enableRoutines(ctx, "beta", ["trend-radar", "follow-ups"])).toEqual(["trend-radar-beta", "follow-ups"]);
    const text = fs.readFileSync(path.join(ctx.root, "mkt.config.yaml"), "utf8");
    expect(text).toMatch(/^# mkt-harness configuration/);
    const r = Object.fromEntries(ctx.config.routines.map((x) => [x.name, x]));
    expect(r["trend-radar"]).toMatchObject({ enabled: true, brand: "acme" });
    expect(r["trend-radar-beta"]).toMatchObject({ enabled: true, brand: "beta", cron: r["trend-radar"].cron });
    expect(r["follow-ups"]).toMatchObject({ enabled: true, brand: "beta" });
  });
});

describe("guided setup", () => {
  it("first run: brand, accounts with secrets in .env, logins, routines, background service, then opens the agent", async () => {
    const ctx = makeRoot();
    const { deps, calls } = fakeDeps();
    const p = new ScriptedPrompter([
      { q: /^Brand name/, a: "Acme Clinics" },
      { q: /^Short id/, a: "acme" },
      { q: /^Website/, a: "acme.com" },
      { q: /^Languages/, a: ["pt", "en"] },
      { q: /^Timezone/, a: "America/Sao_Paulo" },
      { q: /^Where does Acme Clinics/, a: ["instagram", "email", "whatsapp"] },
      { q: /^Instagram username/, a: "@acmeclinics" },
      { q: /read Instagram messages/, a: true },
      { q: /How should mkt send email/, a: "smtp" },
      { q: /^Email address/, a: "hello@acme.com" },
      { q: /^Email provider/, a: "gmail" },
      { q: /^Login/, a: "hello@acme.com" },
      { q: /^Password/, a: "app pass" },
      { q: /^Sender name/, a: "Acme Clinics" },
      { q: /How should mkt use WhatsApp/, a: "browser" },
      { q: /WhatsApp number/, a: "+55 11 99999 0000" },
      { q: /read this inbox/, a: true },
      { q: /^Log in to 2 accounts now/, a: true },
      { q: /In that window, log in to Instagram/, a: "check" },
      { q: /In that window, log in to Instagram/, a: "check" },
      { q: /In that window, scan the QR code/, a: "skip" },
      { q: /Which agent runs the scheduled work/, a: "codex" },
      { q: /^Routines for Acme Clinics/, a: ["trend-radar", "inbox-triage"] },
      { q: /Keep mkt running in the background/, a: true },
      { q: /^Start now/, a: "claude" },
    ]);
    await runSetup(ctx, p, deps);

    // workspace + wiring
    expect(fs.existsSync(path.join(ctx.root, ".mcp.json"))).toBe(true);
    expect(fs.lstatSync(path.join(ctx.root, ".claude", "skills")).isSymbolicLink()).toBe(true);
    // brand
    const brand = YAML.parse(fs.readFileSync(path.join(ctx.ws, "brands", "acme", "brand.yaml"), "utf8"));
    expect(brand).toMatchObject({ name: "Acme Clinics", website: "https://acme.com", languages: ["pt", "en"], timezone: "America/Sao_Paulo" });
    // accounts
    const accounts = Object.fromEntries(listAccounts(ctx, "acme").map((a) => [a.id, a]));
    expect(accounts["acme-instagram"]).toMatchObject({ platform: "instagram", handle: "@acmeclinics", transport: "browser", inbox: true });
    expect(accounts["acme-whatsapp"]).toMatchObject({ platform: "whatsapp", transport: "browser", inbox: true });
    expect(accounts["acme-email"]).toMatchObject({
      transport: "smtp", inbox: true,
      email: { from: "Acme Clinics <hello@acme.com>", smtpUrlEnv: "MKT_SMTP_ACME_EMAIL", imapUrlEnv: "MKT_IMAP_ACME_EMAIL" },
    });
    // secrets only in .env
    const env = fs.readFileSync(path.join(ctx.root, ".env"), "utf8");
    expect(env).toContain("MKT_SMTP_ACME_EMAIL=smtps://hello%40acme.com:app%20pass@smtp.gmail.com:465");
    expect(env).toContain("MKT_IMAP_ACME_EMAIL=imaps://hello%40acme.com:app%20pass@imap.gmail.com:993");
    expect(fs.readFileSync(path.join(ctx.ws, "brands", "acme", "accounts.yaml"), "utf8")).not.toContain("app pass");
    // config
    expect(ctx.config.engine).toBe("codex");
    expect(ctx.config.routines.filter((r) => r.enabled).map((r) => [r.name, r.brand])).toEqual([["trend-radar", "acme"], ["inbox-triage", "acme"]]);
    // side effects, in order
    expect(calls).toEqual([
      "smtp smtps://hello%40acme.com:app%20pass@smtp.gmail.com:465",
      "open acme-instagram", "check acme-instagram", "check acme-instagram", "close acme-instagram",
      "open acme-whatsapp", "close acme-whatsapp",
      "daemon",
      "launch claude /brand-foundation acme",
    ]);
  });

  it("returns to a menu once a brand exists, and exits cleanly", async () => {
    const ctx = makeRoot();
    await runSetup(ctx, new ScriptedPrompter([
      { q: /^Brand name/, a: "Beta" }, { q: /^Short id/, a: "beta" }, { q: /^Website/, a: "" }, { q: /^Languages/, a: ["en"] },
      { q: /^Timezone/, a: "Europe/Madrid" }, { q: /^Where does/, a: [] }, { q: /Which agent/, a: "claude" }, { q: /^Routines/, a: [] },
      { q: /Keep mkt running/, a: false }, { q: /^Start now/, a: "done" },
    ]), fakeDeps().deps);
    const p = new ScriptedPrompter([{ q: /What do you want to do/, a: "exit" }]);
    await runSetup(ctx, p, fakeDeps().deps);
    expect(p.shown.at(-1)).toMatch(/Run mkt any time/);
  });

  it("asks again when the SMTP login fails, and stops on cancel", async () => {
    const ctx = makeRoot();
    let tries = 0;
    const { deps } = fakeDeps({
      verifySmtp: async () => {
        if (++tries === 1) throw new Error("535 bad credentials");
      },
    });
    const p = new ScriptedPrompter([
      { q: /^Brand name/, a: "Gamma" }, { q: /^Short id/, a: "gamma" }, { q: /^Website/, a: "" }, { q: /^Languages/, a: ["es"] },
      { q: /^Timezone/, a: "Europe/Madrid" }, { q: /^Where does/, a: ["email"] },
      { q: /How should mkt send email/, a: "smtp" }, { q: /^Email address/, a: "hola@gamma.es" },
      { q: /^Email provider/, a: "custom" }, { q: /^SMTP server/, a: "smtps://mail.gamma.es:465" }, { q: /^IMAP server/, a: "" },
      { q: /^Login/, a: "hola@gamma.es" }, { q: /^Password/, a: "wrong" }, { q: /^Sender name/, a: "Gamma" },
      { q: /didn't work/, a: "retry" },
      { q: /^Email provider/, a: "custom" }, { q: /^SMTP server/, a: "smtps://mail.gamma.es:465" }, { q: /^IMAP server/, a: "" },
      { q: /^Login/, a: "hola@gamma.es" }, { q: /^Password/, a: "right" }, { q: /^Sender name/, a: "Gamma" },
      // answers run out at the next prompt: behaves like Ctrl+C
    ]);
    await expect(runSetup(ctx, p, deps)).rejects.toBeInstanceOf(Cancelled);
    const [email] = listAccounts(ctx, "gamma");
    expect(email).toMatchObject({ transport: "smtp", inbox: false, email: { smtpUrlEnv: "MKT_SMTP_GAMMA_EMAIL" } });
    expect(email.email?.imapUrlEnv).toBeUndefined();
    expect(fs.readFileSync(path.join(ctx.root, ".env"), "utf8")).toContain("MKT_SMTP_GAMMA_EMAIL=smtps://hola%40gamma.es:right@mail.gamma.es:465");
    expect(tries).toBe(2);
  });
});
