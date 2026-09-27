import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { chromePath } from "../browser/chrome.js";
import { loadConfig, type Ctx } from "../core/config.js";
import { MktError, writeFileAtomic } from "../core/store.js";

// ---------------------------------------------------------------- workspace

/** Workspace, config, MCP wiring for Claude Code and Codex, skill links. Safe to run again. */
export function initWorkspace(ctx: Ctx): string[] {
  const done: string[] = [];
  fs.mkdirSync(path.join(ctx.ws, "brands"), { recursive: true });
  fs.mkdirSync(path.join(ctx.ws, "state"), { recursive: true });
  const cfg = path.join(ctx.root, "mkt.config.yaml");
  if (!fs.existsSync(cfg)) {
    fs.copyFileSync(path.join(ctx.root, "templates", "mkt.config.yaml"), cfg);
    done.push("mkt.config.yaml");
  }
  const bin = path.join(ctx.root, "bin", "mkt");
  writeFileAtomic(path.join(ctx.root, ".mcp.json"), JSON.stringify({ mcpServers: { mkt: { command: bin, args: ["mcp"] } } }, null, 2) + "\n");
  writeFileAtomic(
    path.join(ctx.root, ".codex", "config.toml"),
    `# Project MCP config for Codex (trusted projects). Regenerate with: mkt init\n[mcp_servers.mkt]\ncommand = ${JSON.stringify(bin)}\nargs = ["mcp"]\ntool_timeout_sec = 300\n`,
  );
  done.push(".mcp.json (Claude Code)", ".codex/config.toml (Codex)");
  for (const link of [path.join(ctx.root, ".claude", "skills"), path.join(ctx.root, ".agents", "skills")]) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try {
      if (!fs.lstatSync(link).isSymbolicLink()) throw new MktError(`${link} exists and is not a symlink`);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      fs.symlinkSync(path.relative(path.dirname(link), path.join(ctx.root, "skills")), link);
      done.push(path.relative(ctx.root, link));
    }
  }
  return done;
}

// ---------------------------------------------------------------- tools on this machine

export interface ToolCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function versionOf(bin: string): { ok: boolean; detail: string } {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (r.status === 0) return { ok: true, detail: (r.stdout || r.stderr).trim().split("\n")[0] };
  if (r.error && (r.error as any).code === "ENOENT") return { ok: false, detail: "not installed" };
  return { ok: false, detail: r.signal ? `crashed on launch (${r.signal}): reinstall it` : `exit ${r.status}` };
}

export function detectTools(ctx: Ctx): { checks: ToolCheck[]; engines: ("claude" | "codex")[] } {
  const major = +process.versions.node.split(".")[0];
  const checks: ToolCheck[] = [{ name: "Node.js", ok: major >= 22, detail: process.versions.node }];
  try {
    checks.push({ name: "Google Chrome", ok: true, detail: chromePath(ctx) });
  } catch {
    checks.push({ name: "Google Chrome", ok: false, detail: "not found: install it from google.com/chrome" });
  }
  const claude = versionOf(ctx.config.runner.claude.bin);
  const codex = versionOf(ctx.config.runner.codex.bin);
  checks.push({ name: "Claude Code", ...claude }, { name: "Codex", ...codex });
  const engines = [...(claude.ok ? ["claude" as const] : []), ...(codex.ok ? ["codex" as const] : [])];
  return { checks, engines };
}

// ---------------------------------------------------------------- .env

/** Env var names: MKT_<KIND>_<ACCOUNT>, e.g. MKT_SMTP_ACME_EMAIL. */
export function envName(kind: string, accountId: string): string {
  return `MKT_${kind}_${accountId}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

const quote = (v: string) => (/^[A-Za-z0-9_./:@%+=,-]*$/.test(v) ? v : JSON.stringify(v));

/** Set keys in a dotenv file, keeping every other line (comments included). The file is private to the user. */
export function upsertEnv(file: string, entries: Record<string, string>): void {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  if (lines.at(-1) === "") lines.pop();
  const left = new Map(Object.entries(entries));
  const out = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && left.has(m[1])) {
      const v = left.get(m[1])!;
      left.delete(m[1]);
      return `${m[1]}=${quote(v)}`;
    }
    return line;
  });
  for (const [k, v] of left) out.push(`${k}=${quote(v)}`);
  writeFileAtomic(file, out.join("\n") + "\n");
  fs.chmodSync(file, 0o600);
  for (const [k, v] of Object.entries(entries)) process.env[k] = v;
}

// ---------------------------------------------------------------- email

export const MAIL_PROVIDERS = {
  gmail: { label: "Gmail / Google Workspace", smtp: "smtps://smtp.gmail.com:465", imap: "imaps://imap.gmail.com:993", help: "Use an app password: myaccount.google.com/apppasswords (needs 2-step verification)." },
  outlook: { label: "Outlook / Microsoft 365", smtp: "smtp://smtp.office365.com:587", imap: "imaps://outlook.office365.com:993", help: "Your admin may need to allow SMTP AUTH for this mailbox." },
  zoho: { label: "Zoho Mail", smtp: "smtps://smtp.zoho.com:465", imap: "imaps://imap.zoho.com:993", help: "Use an app-specific password if 2FA is on." },
} as const;
export type MailProvider = keyof typeof MAIL_PROVIDERS | "custom";

/** "smtps://smtp.gmail.com:465" + user/pass -> "smtps://user%40x.com:p%40ss@smtp.gmail.com:465" */
export function withAuth(url: string, user: string, pass: string): string {
  const u = new URL(url);
  return `${u.protocol}//${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${u.host}`;
}

// ---------------------------------------------------------------- mkt.config.yaml

/** Edit mkt.config.yaml as a YAML document so comments survive, then reload ctx.config. */
export function editConfig(ctx: Ctx, fn: (doc: YAML.Document) => void): void {
  const file = path.join(ctx.root, "mkt.config.yaml");
  const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  fn(doc);
  writeFileAtomic(file, doc.toString({ lineWidth: 0 }));
  ctx.config = loadConfig(ctx.root);
}

/**
 * Turn routines on for a brand. A routine already enabled for another brand is copied as `<name>-<brand>` so each
 * brand keeps its own schedule.
 */
export function enableRoutines(ctx: Ctx, brand: string, names: string[]): string[] {
  const enabled: string[] = [];
  editConfig(ctx, (doc) => {
    let seq = doc.get("routines") as YAML.YAMLSeq | undefined;
    if (!seq) {
      doc.set("routines", doc.createNode([]));
      seq = doc.get("routines") as YAML.YAMLSeq;
    }
    for (const name of names) {
      const items = seq.items as YAML.YAMLMap[];
      const base = items.find((m) => m.get("name") === name);
      if (!base) continue;
      const busy = base.get("enabled") === true && base.get("brand") && base.get("brand") !== brand;
      if (!busy) {
        base.set("enabled", true);
        base.set("brand", brand);
        enabled.push(name);
        continue;
      }
      const copyName = `${name}-${brand}`;
      const existing = items.find((m) => m.get("name") === copyName);
      if (existing) existing.set("enabled", true);
      else {
        const copy = doc.createNode({ ...(base.toJSON() as object), name: copyName, brand, enabled: true }) as YAML.YAMLMap;
        seq.add(copy);
      }
      enabled.push(copyName);
    }
  });
  return enabled;
}
