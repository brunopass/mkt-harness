import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { chromePath } from "../browser/chrome.js";
import { loadConfig, type Ctx } from "../core/config.js";
import { approvePendingForAutopilot, listOutbox, revokeAutopilotApprovals } from "../core/outbox.js";
import { OUTBOX_KINDS, type OutboxKind } from "../core/schemas.js";
import { audit, MktError, writeFileAtomic } from "../core/store.js";

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

/** Where an agent can be opened: its terminal CLI or its desktop app. */
export type Surface = "claude" | "claude-desktop" | "codex" | "codex-desktop";
export const SURFACES: readonly Surface[] = ["claude", "claude-desktop", "codex", "codex-desktop"];
export const engineOf = (s: Surface): "claude" | "codex" => (s.startsWith("claude") ? "claude" : "codex");

/** A macOS app bundle in /Applications or ~/Applications. Desktop apps are optional; other OSes report none. */
export function findApp(name: string): string | undefined {
  if (process.env.MKT_APPS_DIR) {
    const p = path.join(process.env.MKT_APPS_DIR, `${name}.app`);
    return fs.existsSync(p) ? p : undefined;
  }
  if (process.platform !== "darwin") return undefined;
  return [path.join("/Applications", `${name}.app`), path.join(os.homedir(), "Applications", `${name}.app`)].find((p) => fs.existsSync(p));
}

export function detectTools(ctx: Ctx): { checks: ToolCheck[]; engines: ("claude" | "codex")[]; surfaces: Surface[] } {
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
  const claudeApp = findApp("Claude");
  const codexApp = findApp("Codex");
  checks.push(
    { name: "Claude app", ok: !!claudeApp, detail: claudeApp ?? "not installed (optional)" },
    { name: "Codex app", ok: !!codexApp, detail: codexApp ?? "not installed (optional)" },
  );
  const engines = [...(claude.ok ? ["claude" as const] : []), ...(codex.ok ? ["codex" as const] : [])];
  const surfaces: Surface[] = [
    ...(claude.ok ? ["claude" as const] : []),
    ...(claudeApp ? ["claude-desktop" as const] : []),
    ...(codex.ok ? ["codex" as const] : []),
    ...(codexApp ? ["codex-desktop" as const] : []),
  ];
  return { checks, engines, surfaces };
}

// ---------------------------------------------------------------- .env

/** Env var names: MKT_<KIND>_<ACCOUNT>, e.g. MKT_SMTP_ACME_EMAIL. */
export function envName(kind: string, accountId: string): string {
  return `MKT_${kind}_${accountId}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Quote for Node's .env parser (process.loadEnvFile): single quotes and backticks are literal; double quotes turn "\\n"
 * into a newline and don't unescape \\". Values that no quoting keeps intact are refused rather than corrupted.
 */
export function quoteEnv(v: string): string {
  if (/[\r\n\0]/.test(v)) throw new MktError("a .env value can't contain line breaks");
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes("`")) return `\`${v}\``;
  if (!v.includes('"') && !v.includes("\\")) return `"${v}"`;
  throw new MktError("this value mixes quote characters in a way .env can't store; use a different secret");
}

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
      return `${m[1]}=${quoteEnv(v)}`;
    }
    return line;
  });
  for (const [k, v] of left) out.push(`${k}=${quoteEnv(v)}`);
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

// ---------------------------------------------------------------- review / autopilot

/**
 * Tools a Claude Code session may use without asking once autopilot is on: sending approved items and driving the
 * browser. Written to .claude/settings.local.json (personal, not committed) so review mode keeps asking for them.
 */
export const AUTOPILOT_CLAUDE_TOOLS = ["outbox_dispatch", "outbox_claim", "outbox_complete", "browser_click", "browser_type", "browser_press", "browser_upload", "browser_close"].map(
  (t) => `mcp__mkt__${t}`,
);

export function setClaudeAutopilot(ctx: Ctx, on: boolean): void {
  const file = path.join(ctx.root, ".claude", "settings.local.json");
  let s: any = {};
  try {
    s = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw new MktError(`${file} is not valid JSON; fix it before switching modes`);
  }
  s.permissions ??= {};
  const rest: string[] = (s.permissions.allow ?? []).filter((r: string) => !AUTOPILOT_CLAUDE_TOOLS.includes(r));
  s.permissions.allow = on ? [...rest, ...AUTOPILOT_CLAUDE_TOOLS] : rest;
  if (!s.permissions.allow.length) delete s.permissions.allow;
  if (!Object.keys(s.permissions).length) delete s.permissions;
  if (!Object.keys(s).length) {
    fs.rmSync(file, { force: true });
    return;
  }
  writeFileAtomic(file, JSON.stringify(s, null, 2) + "\n");
}

export interface ModeSwitch {
  mode: "review" | "autopilot";
  kinds: OutboxKind[];
  approved: number;
  revoked: number;
  held: number;
}

/**
 * Switch the harness between review and autopilot. Turning autopilot on can approve what's already waiting (never held
 * items); turning it off sends everything autopilot approved and hasn't sent back to review.
 */
export function switchMode(ctx: Ctx, mode: "review" | "autopilot", opts: { kinds?: OutboxKind[]; approvePending?: boolean } = {}): ModeSwitch {
  const kinds = opts.kinds ?? (ctx.config.autopilot.kinds as OutboxKind[]);
  if (kinds.some((k) => !(OUTBOX_KINDS as readonly string[]).includes(k))) throw new MktError(`kinds must be among ${OUTBOX_KINDS.join(", ")}`);
  const cfg = path.join(ctx.root, "mkt.config.yaml");
  if (!fs.existsSync(cfg)) fs.copyFileSync(path.join(ctx.root, "templates", "mkt.config.yaml"), cfg);
  editConfig(ctx, (doc) => {
    doc.set("mode", mode);
    doc.setIn(["autopilot", "kinds"], doc.createNode(kinds, { flow: true }));
  });
  setClaudeAutopilot(ctx, mode === "autopilot");
  const approved = mode === "autopilot" && opts.approvePending ? approvePendingForAutopilot(ctx).length : 0;
  const revoked = mode === "review" ? revokeAutopilotApprovals(ctx).length : 0;
  const held = listOutbox(ctx, undefined, { status: ["pending_approval"] }).filter((i) => i.hold).length;
  audit(ctx, "mode.switch", { detail: { mode, kinds, approved, revoked } });
  return { mode, kinds, approved, revoked, held };
}
