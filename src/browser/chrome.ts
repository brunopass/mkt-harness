import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { getAccount } from "../core/brands.js";
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

/**
 * Chrome writes the port it actually bound to <profile>/DevToolsActivePort. Reading it from the profile ties a port to
 * this account: a Chrome listening on some port is only ours if its profile says so.
 */
function devtoolsPort(dir: string): number | undefined {
  try {
    const port = Number(fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

/** Does this pid run Chrome with this profile? (Ownership check for instances started before DevToolsActivePort.) */
function pidRunsProfile(pid: number | undefined, dir: string): boolean {
  if (!pid || process.platform === "win32") return false;
  const r = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  return r.status === 0 && r.stdout.includes(`--user-data-dir=${dir}`);
}

/**
 * The running Chrome for this profile, if any. The recorded port must match the profile's own DevToolsActivePort, or,
 * for a Chrome started by an older mkt with a fixed port, the recorded process must be running this profile.
 */
async function runningPort(ctx: Ctx, account: string): Promise<number | undefined> {
  const st = readJson<ProfileState | null>(profileStateFile(ctx, account), null);
  if (!st?.port) return undefined;
  const dir = profileDir(ctx, account);
  const owned = devtoolsPort(dir) === st.port || pidRunsProfile(st.pid, dir);
  return owned && (await isAlive(st.port)) ? st.port : undefined;
}

export async function chromeStatus(ctx: Ctx, account: string): Promise<{ account: string; port?: number; alive: boolean; headless?: boolean; profile: string }> {
  const st = readJson<ProfileState | null>(profileStateFile(ctx, account), null);
  const port = await runningPort(ctx, account);
  return { account, port: port ?? st?.port, alive: !!port, headless: st?.headless, profile: profileDir(ctx, account) };
}

/** Start Chrome for this account unless it is already running. */
export async function ensureChrome(ctx: Ctx, account: string, opts: { headless?: boolean; url?: string } = {}): Promise<{ port: number; launched: boolean }> {
  if (account !== RESEARCH_PROFILE) getAccount(ctx, account);
  const running = await runningPort(ctx, account);
  if (running) return { port: running, launched: false };

  const dir = profileDir(ctx, account);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, "DevToolsActivePort"), { force: true });
  // unattended runs (routines, background research) never pop up windows
  const headless = opts.headless ?? (process.env.MKT_HEADLESS_BROWSER === "1" || ctx.config.browser.headless);
  const args = [
    `--user-data-dir=${dir}`,
    // port 0: Chrome picks a free port and records it in the profile, so two launches can never share one
    "--remote-debugging-port=0",
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
    const port = devtoolsPort(dir);
    if (port && (await isAlive(port))) {
      writeJson(profileStateFile(ctx, account), { port, pid: child.pid, headless, startedAt: new Date().toISOString() } satisfies ProfileState);
      return { port, launched: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new MktError(
    `Chrome for ${account} did not open a debugging port. If a Chrome window is already using this profile ` +
      `(${dir}) without mkt, close it and retry.`,
  );
}

const connections = new Map<string, Browser>();
const activePages = new Map<string, Page>();
/** Tabs the harness opened in this process, per account, with when they were last used. Only these are ever closed. */
const owned = new Map<string, Map<Page, number>>();

function own(account: string, page: Page): Page {
  let m = owned.get(account);
  if (!m) owned.set(account, (m = new Map()));
  m.set(page, Date.now());
  page.once("close", () => m!.delete(page));
  return page;
}

/** Mark a harness tab as just used (keeps the idle sweep away from it). */
export function touchPage(account: string, page: Page): void {
  const m = owned.get(account);
  if (m?.has(page)) m.set(page, Date.now());
}

export function ownedPages(account: string): Page[] {
  return [...(owned.get(account)?.keys() ?? [])].filter((p) => !p.isClosed());
}

/**
 * A new tab that belongs to the harness. A freshly launched Chrome shows one blank tab: adopt it instead of leaving it
 * behind.
 */
async function newOwnedPage(context: BrowserContext, account: string): Promise<Page> {
  const pages = context.pages().filter((p) => !p.isClosed());
  const blank = pages.length === 1 && pages[0].url() === "about:blank" && !isOwnedAnywhere(pages[0]) ? pages[0] : undefined;
  return own(account, blank ?? (await context.newPage()));
}

const isOwnedAnywhere = (p: Page) => [...owned.values()].some((m) => m.has(p));

export async function attach(ctx: Ctx, account: string, opts: { headless?: boolean } = {}): Promise<{ browser: Browser; context: BrowserContext }> {
  const { port } = await ensureChrome(ctx, account, opts);
  let browser = connections.get(account);
  if (!browser || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20_000 });
    connections.set(account, browser);
    browser.on("disconnected", () => {
      connections.delete(account);
      activePages.delete(account);
      owned.delete(account);
    });
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return { browser, context };
}

const usable = (p: Page) => !p.isClosed() && !/^(devtools|chrome-extension|chrome):\/\//.test(p.url());

/**
 * The page an agent is working on for this account: always a tab the harness opened (never one the human has open),
 * unless the agent explicitly switched to another with browser_tabs. `newTab` gives the caller a private tab (the
 * dispatcher uses that so it never navigates away from what an agent is looking at).
 */
export async function getPage(ctx: Ctx, account: string, opts: { url?: string; newTab?: boolean; headless?: boolean } = {}): Promise<Page> {
  // launch on a blank tab (which newOwnedPage adopts), then navigate: passing the URL to the launch would leave a
  // second, unowned tab on the same page
  const { context } = await attach(ctx, account, { headless: opts.headless });
  let page: Page;
  if (opts.newTab) page = await newOwnedPage(context, account);
  else {
    const cur = activePages.get(account);
    page = cur && usable(cur) ? cur : await newOwnedPage(context, account);
    activePages.set(account, page);
  }
  touchPage(account, page);
  if (opts.url) await goto(ctx, page, opts.url);
  return page;
}

/**
 * Close the tabs the harness opened for an account (optionally only those idle for `idleMs`). With closeChromeIfEmpty,
 * also close Chrome when no tab is left, so nothing lingers on screen. Tabs the human opened are never touched.
 */
export async function closeOwnedTabs(ctx: Ctx, account: string, opts: { idleMs?: number; closeChromeIfEmpty?: boolean } = {}): Promise<{ closed: number; chromeClosed: boolean }> {
  const m = owned.get(account);
  let closed = 0;
  const now = Date.now();
  for (const [page, used] of [...(m?.entries() ?? [])]) {
    if (opts.idleMs != null && now - used < opts.idleMs) continue;
    if (activePages.get(account) === page) activePages.delete(account);
    if (!page.isClosed()) {
      await page.close().catch(() => {});
      closed++;
    }
    m!.delete(page);
  }
  let chromeClosed = false;
  if (opts.closeChromeIfEmpty) {
    const b = connections.get(account);
    const left = b?.isConnected() ? b.contexts().flatMap((c) => c.pages()).filter(usable).length : 0;
    if (b?.isConnected() && left === 0) chromeClosed = await closeChrome(ctx, account);
  }
  return { closed, chromeClosed };
}

/** Every account's harness tabs (session end, idle sweep). */
export async function closeAllOwnedTabs(ctx: Ctx, opts: { idleMs?: number; closeChromeIfEmpty?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const account of [...owned.keys()]) n += (await closeOwnedTabs(ctx, account, opts)).closed;
  return n;
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
  if (!st?.port || !(await runningPort(ctx, account))) return false;
  try {
    const b = connections.get(account) ?? (await chromium.connectOverCDP(`http://127.0.0.1:${st.port}`, { timeout: 5_000 }));
    const s = await b.newBrowserCDPSession();
    await s.send("Browser.close").catch(() => {});
  } catch {}
  // wait until it's really gone, so a relaunch right after never attaches to a dying browser
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && (await isAlive(st.port))) await new Promise((r) => setTimeout(r, 150));
  if ((await isAlive(st.port)) && st.pid) {
    try {
      process.kill(st.pid);
    } catch {}
  }
  connections.delete(account);
  activePages.delete(account);
  owned.delete(account);
  return true;
}

/** Close the tabs this process opened, then drop our CDP connections. Chrome and the human's tabs stay open. */
export async function detachAll(): Promise<void> {
  for (const m of owned.values()) for (const page of m.keys()) if (!page.isClosed()) await page.close().catch(() => {});
  for (const [id, b] of connections) {
    connections.delete(id);
    // connectOverCDP: close() only disconnects this client; the Chrome window keeps running
    await b.close().catch(() => {});
  }
  activePages.clear();
  owned.clear();
}

export function shotPath(ctx: Ctx, account: string, label: string): string {
  const dir = path.join(ctx.ws, ".shots", account);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `${stamp}-${label.replace(/[^a-z0-9-]+/gi, "_").slice(0, 40)}.png`);
}

// ---------------------------------------------------------------- jobs (send, inbox sync, login checks)

/**
 * Run a job in a private harness tab of the account's Chrome. The tab closes afterwards, and if the job had to start
 * Chrome, Chrome closes too: background work leaves nothing running or on screen. `keep()` can keep the tab (dry run
 * the human wants to look at).
 */
export async function withJobPage<T>(ctx: Ctx, account: string, fn: (page: Page) => Promise<T>, keep: () => boolean = () => false): Promise<T> {
  const wasRunning = !!(await runningPort(ctx, account));
  const page = await getPage(ctx, account, { newTab: true });
  try {
    return await fn(page);
  } finally {
    if (!keep()) {
      await page.close().catch(() => {});
      if (!wasRunning) await closeChrome(ctx, account);
    }
  }
}

interface LoggedOut {
  at: string;
  reason: string;
}
const loginStateFile = (ctx: Ctx) => path.join(ctx.ws, "state", "logged-out.json");

/** Accounts found logged out: background jobs skip them for a day instead of opening Chrome every few minutes. */
export function loggedOutAccounts(ctx: Ctx): Record<string, LoggedOut> {
  return readJson<Record<string, LoggedOut>>(loginStateFile(ctx), {});
}

export function markLoggedOut(ctx: Ctx, account: string, reason: string): void {
  const all = loggedOutAccounts(ctx);
  all[account] = { at: new Date().toISOString(), reason };
  writeJson(loginStateFile(ctx), all);
}

export function markLoggedIn(ctx: Ctx, account: string): void {
  const all = loggedOutAccounts(ctx);
  if (!(account in all)) return;
  delete all[account];
  writeJson(loginStateFile(ctx), all);
}

/** Logged out less than `hours` ago: skip it in background jobs (a daily retry picks up a login done elsewhere). */
export function recentlyLoggedOut(ctx: Ctx, account: string, hours = 24, now = Date.now()): LoggedOut | undefined {
  const e = loggedOutAccounts(ctx)[account];
  return e && now - Date.parse(e.at) < hours * 3_600_000 ? e : undefined;
}
