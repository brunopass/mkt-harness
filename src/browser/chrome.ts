import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { getAccount, listAccounts } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { MktError, readJson, writeJson } from "../core/store.js";

/**
 * One real Chrome per account, each with its own user-data-dir (cookies, logins) and a local CDP port.
 * The human logs in once in that window; the MCP server, the daemon and the CLI all attach to the same
 * running browser over CDP. Nothing here hides automation: no stealth patches, no fingerprint games.
 */

interface ProfileState {
  port: number;
  pid?: number;
  headless: boolean;
  startedAt: string;
}

/** A profile not tied to any brand account: research and reading without acting as a brand. */
export const RESEARCH_PROFILE = "research";

export const profileDir = (ctx: Ctx, account: string) => path.join(ctx.ws, ".profiles", account);
const profileStateFile = (ctx: Ctx, account: string) => path.join(profileDir(ctx, account), "mkt-browser.json");

export function chromePath(ctx: Ctx): string {
  const explicit = ctx.config.browser.executablePath ?? process.env.MKT_CHROME_PATH;
  if (explicit) return explicit;
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((c) => fs.existsSync(c));
  if (found) return found;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  throw new MktError("Chrome not found: install Google Chrome or set browser.executablePath in mkt.config.yaml (or MKT_CHROME_PATH)");
}

export async function isAlive(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

async function allocatePort(ctx: Ctx, account: string): Promise<number> {
  const taken = new Set<number>();
  for (const id of [...listAccounts(ctx).map((a) => a.id), RESEARCH_PROFILE]) {
    if (id === account) continue;
    const st = readJson<ProfileState | null>(profileStateFile(ctx, id), null);
    if (st?.port) taken.add(st.port);
  }
  const prev = readJson<ProfileState | null>(profileStateFile(ctx, account), null);
  if (prev?.port && !taken.has(prev.port) && (await portFree(prev.port))) return prev.port;
  for (let p = ctx.config.browser.basePort; p < ctx.config.browser.basePort + 500; p++) {
    if (!taken.has(p) && (await portFree(p))) return p;
  }
  throw new MktError("no free port for Chrome remote debugging");
}

export async function chromeStatus(ctx: Ctx, account: string): Promise<{ account: string; port?: number; alive: boolean; headless?: boolean; profile: string }> {
  const st = readJson<ProfileState | null>(profileStateFile(ctx, account), null);
  return { account, port: st?.port, alive: st?.port ? await isAlive(st.port) : false, headless: st?.headless, profile: profileDir(ctx, account) };
}

/** Start Chrome for this account unless it is already running. */
export async function ensureChrome(ctx: Ctx, account: string, opts: { headless?: boolean; url?: string } = {}): Promise<{ port: number; launched: boolean }> {
  if (account !== RESEARCH_PROFILE) getAccount(ctx, account);
  const st = readJson<ProfileState | null>(profileStateFile(ctx, account), null);
  if (st?.port && (await isAlive(st.port))) return { port: st.port, launched: false };

  const dir = profileDir(ctx, account);
  fs.mkdirSync(dir, { recursive: true });
  const port = await allocatePort(ctx, account);
  // unattended runs (routines, background research) never pop up windows
  const headless = opts.headless ?? (process.env.MKT_HEADLESS_BROWSER === "1" || ctx.config.browser.headless);
  const args = [
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${ctx.config.browser.windowSize}`,
    ...(headless ? ["--headless=new"] : []),
    opts.url ?? "about:blank",
  ];
  const child = spawn(chromePath(ctx), args, { detached: true, stdio: "ignore" });
  child.unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isAlive(port)) {
      writeJson(profileStateFile(ctx, account), { port, pid: child.pid, headless, startedAt: new Date().toISOString() } satisfies ProfileState);
      return { port, launched: true };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new MktError(
    `Chrome for ${account} did not open a debugging port. If a Chrome window is already using this profile ` +
      `(${dir}) without mkt, close it and retry.`,
  );
}

const connections = new Map<string, Browser>();
const activePages = new Map<string, Page>();

export async function attach(ctx: Ctx, account: string, opts: { headless?: boolean } = {}): Promise<{ browser: Browser; context: BrowserContext }> {
  const { port } = await ensureChrome(ctx, account, opts);
  let browser = connections.get(account);
  if (!browser || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20_000 });
    connections.set(account, browser);
    browser.on("disconnected", () => {
      connections.delete(account);
      activePages.delete(account);
    });
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return { browser, context };
}

const usable = (p: Page) => !p.isClosed() && !/^(devtools|chrome-extension|chrome):\/\//.test(p.url());

/**
 * The page an agent is working on for this account. `newTab` gives the caller a private tab (the dispatcher uses
 * that so it never navigates away from what an agent is looking at).
 */
export async function getPage(ctx: Ctx, account: string, opts: { url?: string; newTab?: boolean; headless?: boolean } = {}): Promise<Page> {
  const { context } = await attach(ctx, account, opts);
  let page: Page | undefined;
  if (opts.newTab) page = await context.newPage();
  else {
    const cur = activePages.get(account);
    page = cur && usable(cur) ? cur : context.pages().filter(usable).at(-1);
    page ??= await context.newPage();
    activePages.set(account, page);
  }
  if (opts.url) await goto(ctx, page, opts.url);
  return page;
}

export async function goto(ctx: Ctx, page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(ctx.config.browser.settleMs);
}

export function setActivePage(account: string, page: Page): void {
  activePages.set(account, page);
}

export async function closeChrome(ctx: Ctx, account: string): Promise<boolean> {
  const st = readJson<ProfileState | null>(profileStateFile(ctx, account), null);
  if (!st?.port || !(await isAlive(st.port))) return false;
  try {
    const b = connections.get(account) ?? (await chromium.connectOverCDP(`http://127.0.0.1:${st.port}`, { timeout: 5_000 }));
    const s = await b.newBrowserCDPSession();
    await s.send("Browser.close").catch(() => {});
  } catch {
    if (st.pid) {
      try {
        process.kill(st.pid);
      } catch {}
    }
  }
  connections.delete(account);
  activePages.delete(account);
  return true;
}

/** Drop our CDP connections without closing anyone's Chrome. */
export async function detachAll(): Promise<void> {
  for (const [id, b] of connections) {
    connections.delete(id);
    // connectOverCDP: close() only disconnects this client; the Chrome window keeps running
    await b.close().catch(() => {});
  }
  activePages.clear();
}

export function shotPath(ctx: Ctx, account: string, label: string): string {
  const dir = path.join(ctx.ws, ".shots", account);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `${stamp}-${label.replace(/[^a-z0-9-]+/gi, "_").slice(0, 40)}.png`);
}
