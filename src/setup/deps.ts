import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { adapterFor, type AdapterEnv } from "../browser/adapters/index.js";
import { chromeStatus, closeChrome, ensureChrome, getPage, goto } from "../browser/chrome.js";
import { getAccount } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { launchdPlist } from "../daemon.js";
import { detectTools } from "./helpers.js";
import type { SetupDeps } from "./tui.js";

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

/** Hand the terminal to Claude Code or Codex in the harness folder, optionally with a first message. */
export function launchAgent(ctx: Ctx, engine: "claude" | "codex", prompt: string): Promise<void> {
  const bin = engine === "claude" ? ctx.config.runner.claude.bin : ctx.config.runner.codex.bin;
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return new Promise((resolve) => {
    const child = spawn(bin, prompt ? [prompt] : [], { cwd: ctx.root, stdio: "inherit", env });
    child.on("exit", () => resolve());
    child.on("error", (e) => {
      console.error(`could not start ${bin}: ${e.message}`);
      resolve();
    });
  });
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
  platform: process.platform,
};
