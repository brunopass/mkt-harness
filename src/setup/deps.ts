import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { adapterFor, type AdapterEnv } from "../browser/adapters/index.js";
import { chromeStatus, closeChrome, ensureChrome, getPage, goto } from "../browser/chrome.js";
import { getAccount } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { launchdPlist } from "../daemon.js";
import { scanSite } from "../research/site.js";
import { detectTools } from "./helpers.js";
import type { ResearchRun, SetupDeps } from "./tui.js";

/** Is this account's Chrome profile logged in? Opens a temporary tab; leaves Chrome as it found it. */
export async function checkLogin(ctx: Ctx, accountId: string): Promise<boolean> {
  const account = getAccount(ctx, accountId);
  const adapter = adapterFor(account.platform);
  const wasRunning = (await chromeStatus(ctx, accountId)).alive;
  const page = await getPage(ctx, accountId, { newTab: true });
  try {
    const env: AdapterEnv = { ctx, account, page, dryRun: true, shot: async () => "", log: () => {}, goto: (u) => goto(ctx, page, u) };
    await env.goto(adapter.homeUrl).catch(() => {});
    return await adapter.isLoggedIn(env);
  } finally {
    await page.close().catch(() => {});
    if (!wasRunning) await closeChrome(ctx, accountId);
  }
}

/** A visible Chrome window for this account, on the platform's login page. */
export async function openForLogin(ctx: Ctx, accountId: string): Promise<void> {
  const account = getAccount(ctx, accountId);
  const url = adapterFor(account.platform).loginUrl;
  // a background run may hold this profile in an invisible (headless) Chrome: a login needs a window you can see
  const st = await chromeStatus(ctx, accountId);
  if (st.alive && st.headless) await closeChrome(ctx, accountId);
  const { launched } = await ensureChrome(ctx, accountId, { headless: false, url });
  if (!launched) {
    const page = await getPage(ctx, accountId, { newTab: true });
    await goto(ctx, page, url);
    await page.bringToFront();
  }
}

export async function verifySmtp(url: string): Promise<void> {
  const t = nodemailer.createTransport(url, { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 } as any);
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

/** Write the launchd agent and (re)load it so it starts now and at every login. */
export async function installDaemon(ctx: Ctx): Promise<string> {
  const { file, xml } = launchdPlist(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xml);
  const uid = process.getuid?.();
  spawnSync("launchctl", ["bootout", `gui/${uid}`, file], { stdio: "ignore" });
  const r = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`launchctl: ${(r.stderr || r.stdout).trim() || `exit ${r.status}`}`);
  return `Background service running (logs: ${path.relative(ctx.root, path.join(ctx.ws, "logs"))}/daemon.log)`;
}

/**
 * Hand the terminal to Claude Code or Codex in the harness folder, optionally with a first message.
 * Under bin/mkt the command is written to MKT_HANDOFF and the shell execs it after Node exits: the agent then owns a
 * clean terminal. Without the shim, reset stdin and run it synchronously.
 */
export async function launchAgent(ctx: Ctx, engine: "claude" | "codex", prompt: string): Promise<void> {
  const bin = engine === "claude" ? ctx.config.runner.claude.bin : ctx.config.runner.codex.bin;
  const argv = [bin, ...(prompt ? [prompt] : [])];
  if (process.env.MKT_HANDOFF) {
    fs.writeFileSync(process.env.MKT_HANDOFF, argv.map((a) => `${a}\0`).join(""));
    return;
  }
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
  }
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const r = spawnSync(argv[0], argv.slice(1), { cwd: ctx.root, stdio: "inherit", env });
  if (r.error) console.error(`could not start ${bin}: ${r.error.message}`);
}

const children = new Map<number, ChildProcess>();

/** The deep research as a detached `mkt agent` run: it outlives the setup and logs to workspace/logs/. */
export async function startResearch(ctx: Ctx, brand: string, engine: "claude" | "codex", prompt: string): Promise<ResearchRun> {
  const dir = path.join(ctx.ws, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, `research-${brand}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const fd = fs.openSync(log, "a");
  const child = spawn(path.join(ctx.root, "bin", "mkt"), ["agent", "--brand", brand, "--engine", engine, "--name", `research-${brand}`, prompt], {
    cwd: ctx.root,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, MKT_WORKSPACE: ctx.ws },
  });
  fs.closeSync(fd);
  child.unref();
  if (!child.pid) throw new Error("could not start the research run");
  children.set(child.pid, child);
  return { pid: child.pid, log, engine };
}

export function isRunning(run: ResearchRun): boolean {
  const c = children.get(run.pid);
  if (c) return c.exitCode === null && c.signalCode === null;
  try {
    process.kill(run.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Output of the latest finished research run for this brand (from workspace/runs/). */
export function researchSummary(ctx: Ctx, brand: string): string | undefined {
  const dir = path.join(ctx.ws, "runs");
  if (!fs.existsSync(dir)) return undefined;
  const f = fs.readdirSync(dir).filter((n) => n.endsWith(`-research-${brand}.json`)).sort().at(-1);
  if (!f) return undefined;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return typeof r.output === "string" && r.output.trim() ? r.output.trim() : undefined;
  } catch {
    return undefined;
  }
}

export const realDeps: SetupDeps = {
  detectTools,
  openForLogin,
  checkLogin,
  closeBrowser: async (ctx, id) => {
    await closeChrome(ctx, id);
  },
  verifySmtp,
  installDaemon,
  launchAgent,
  scanSite: (ctx, url) => scanSite(ctx, url),
  startResearch,
  isRunning,
  researchSummary,
  platform: process.platform,
};
