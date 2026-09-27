import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dryRunStop, typeText } from "../src/browser/adapters/helpers.js";
import { ADAPTERS, type PlatformAdapter } from "../src/browser/adapters/index.js";
import { chromePath, chromeStatus, closeChrome, closeOwnedTabs, detachAll, getPage, isAlive, loggedOutAccounts, ownedPages, profileDir, withJobPage } from "../src/browser/chrome.js";
import { syncAccount, syncAll } from "../src/inbox/sync.js";
import { dispatchOne } from "../src/channels/dispatch.js";
import { draftOutbox } from "../src/core/outbox.js";
import { makeWs, ROOT } from "./helpers.js";

/** Tab hygiene in real headless Chrome: run with `npm run test:browser`. */
const run = process.env.MKT_BROWSER_TESTS === "1" ? describe : describe.skip;

run("browser tabs are cleaned up", () => {
  const ctx = makeWs({ browser: { headless: true, settleMs: 50, idleTabMin: 10 }, limits: { threads: { post: { perDay: 100, minGapSec: 0 } } } });
  fs.appendFileSync(`${ctx.ws}/brands/acme/accounts.yaml`, `  - { id: acme-threads, platform: threads, handle: acme }\n`);
  let base = "";
  let server: http.Server;
  const original = ADAPTERS.threads;

  /** Every open tab in the account's Chrome, seen from a separate CDP client (like the human's view). */
  const allTabs = async (account: string): Promise<string[]> => {
    const st = await chromeStatus(ctx, account);
    if (!st.alive) return [];
    const list = (await (await fetch(`http://127.0.0.1:${st.port}/json/list`)).json()) as { type: string; url: string }[];
    return list.filter((t) => t.type === "page").map((t) => t.url);
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><title>${req.url}</title><main><textarea aria-label="What's new"></textarea><button>Post</button></main>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fake: PlatformAdapter = {
      platform: "threads",
      homeUrl: `${base}/home`,
      loginUrl: `${base}/login`,
      async isLoggedIn() {
        return true;
      },
      async post(env, input) {
        await typeText(env.page, "compose", [(p) => p.getByRole("textbox", { name: "What's new" })], input.text);
        return dryRunStop(env, "post");
      },
    };
    ADAPTERS.threads = fake;
  });

  afterAll(async () => {
    ADAPTERS.threads = original;
    for (const a of ["acme-x", "acme-threads", "acme-threads-2", "acme-ig", "acme-legacy", "research"]) await closeChrome(ctx, a);
    await detachAll();
    server.closeAllConnections();
    server.close();
  });

  it("reuses Chrome's blank start tab, never takes over the human's tabs, and closes only its own", async () => {
    const page = await getPage(ctx, "acme-x", { url: `${base}/agent` });
    expect(await allTabs("acme-x")).toEqual([`${base}/agent`]); // no leftover about:blank

    // the human opens a tab of their own in the same Chrome, through another connection
    const st = await chromeStatus(ctx, "acme-x");
    const human = await chromium.connectOverCDP(`http://127.0.0.1:${st.port}`);
    const humanTab = await human.contexts()[0].newPage();
    await humanTab.goto(`${base}/human`);

    await detachAll(); // the agent session ends (its tab closes); a new one starts and must not grab the human's tab
    expect(page.isClosed()).toBe(true);
    expect(await allTabs("acme-x")).toEqual([`${base}/human`]);
    const agentTab = await getPage(ctx, "acme-x");
    expect(agentTab.url()).not.toBe(`${base}/human`);
    await agentTab.goto(`${base}/agent-2`);

    const r = await closeOwnedTabs(ctx, "acme-x", { closeChromeIfEmpty: true });
    expect(r).toEqual({ closed: 1, chromeClosed: false }); // the human's tab keeps Chrome open
    expect(await allTabs("acme-x")).toEqual([`${base}/human`]);
    await human.close();
  });

  it("closes Chrome once nothing else is open", async () => {
    // close whatever is left from the previous test, including the human tab, then work and clean up
    await closeChrome(ctx, "acme-x");
    await detachAll();
    await getPage(ctx, "acme-x", { url: `${base}/solo` });
    const st = await chromeStatus(ctx, "acme-x");
    expect(await closeOwnedTabs(ctx, "acme-x", { closeChromeIfEmpty: true })).toEqual({ closed: 1, chromeClosed: true });
    await new Promise((r) => setTimeout(r, 800));
    expect(await isAlive(st.port!)).toBe(false);
  });

  it("the idle sweep only closes tabs nobody used recently", async () => {
    await detachAll();
    await getPage(ctx, "acme-ig", { url: `${base}/recent` });
    expect(await closeOwnedTabs(ctx, "acme-ig", { idleMs: 60_000 })).toMatchObject({ closed: 0 });
    expect(ownedPages("acme-ig")).toHaveLength(1);
    expect(await closeOwnedTabs(ctx, "acme-ig", { idleMs: 0 })).toMatchObject({ closed: 1 });
    expect(ownedPages("acme-ig")).toHaveLength(0);
  });

  it("dry runs close their tab (keeping the screenshot) unless asked to keep it open", async () => {
    await detachAll();
    await getPage(ctx, "acme-threads", { url: `${base}/agent` }); // an agent tab that must survive the dispatcher
    const d = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-threads", body: "hello" });
    const closed = await dispatchOne(ctx, d.id, { dryRun: true });
    expect(closed.status).toBe("dry_run");
    expect(fs.existsSync(closed.screenshot!)).toBe(true);
    expect(await allTabs("acme-threads")).toEqual([`${base}/agent`]);

    const kept = await dispatchOne({ ...ctx, config: { ...ctx.config, browser: { ...ctx.config.browser, headless: false } } }, d.id, { dryRun: true, keepOpen: true });
    expect(kept.status).toBe("dry_run");
    expect((await allTabs("acme-threads")).filter((u) => u === `${base}/home`)).toHaveLength(1);
  }, 60_000);

  it("a background job that had to start Chrome closes it; one that found it running closes only its tab", async () => {
    await closeChrome(ctx, "acme-x");
    await detachAll();
    await withJobPage(ctx, "acme-x", async (page) => void (await page.goto(`${base}/job`)));
    expect((await chromeStatus(ctx, "acme-x")).alive).toBe(false);

    await getPage(ctx, "acme-x", { url: `${base}/agent-working` }); // Chrome already open with an agent tab
    await withJobPage(ctx, "acme-x", async (page) => void (await page.goto(`${base}/job-2`)));
    expect(await allTabs("acme-x")).toEqual([`${base}/agent-working`]);
  });

  it("inbox sync leaves no Chrome behind, records a logged-out account and then skips it", async () => {
    await closeChrome(ctx, "acme-threads");
    await detachAll();
    fs.appendFileSync(`${ctx.ws}/brands/acme/accounts.yaml`, `  - { id: acme-threads-2, platform: threads, handle: acme2, inbox: true }\n`);
    ADAPTERS.threads = { ...ADAPTERS.threads, isLoggedIn: async () => false, readInbox: async () => [] };
    try {
      const first = await syncAccount(ctx, "acme-threads-2");
      expect(first.error).toMatch(/not logged in/);
      expect((await chromeStatus(ctx, "acme-threads-2")).alive).toBe(false); // it started Chrome, so it closed it
      expect(loggedOutAccounts(ctx)["acme-threads-2"]).toBeTruthy();
      const again = (await syncAll(ctx)).find((r) => r.account === "acme-threads-2")!;
      expect(again.skipped).toMatch(/logged out since/);
      expect((await chromeStatus(ctx, "acme-threads-2")).alive).toBe(false);
    } finally {
      ADAPTERS.threads = { ...ADAPTERS.threads, isLoggedIn: async () => true };
    }
  }, 60_000);

  it("recognises (and closes) a Chrome started by an older mkt on a fixed port, but never another profile's", async () => {
    const freePort = () => new Promise<number>((r) => { const srv = net.createServer().listen(0, "127.0.0.1", () => { const p = (srv.address() as AddressInfo).port; srv.close(() => r(p)); }); });
    const launchLegacy = async (account: string) => {
      const dir = profileDir(ctx, account);
      fs.mkdirSync(dir, { recursive: true });
      const port = await freePort();
      const child = spawn(chromePath(ctx), [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, "--headless=new", "--no-first-run", "about:blank"], { detached: true, stdio: "ignore" });
      child.unref();
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !(await isAlive(port))) await new Promise((r) => setTimeout(r, 200));
      fs.rmSync(path.join(dir, "DevToolsActivePort"), { force: true }); // what older launches looked like
      fs.writeFileSync(path.join(dir, "mkt-browser.json"), JSON.stringify({ port, pid: child.pid, headless: true, startedAt: new Date().toISOString() }));
      return { port, pid: child.pid! };
    };
    fs.appendFileSync(`${ctx.ws}/brands/acme/accounts.yaml`, `  - { id: acme-legacy, platform: x, handle: legacy }\n  - { id: acme-other, platform: x, handle: other }\n`);
    const legacy = await launchLegacy("acme-legacy");
    try {
      expect(await isAlive(legacy.port)).toBe(true);
      expect(await chromeStatus(ctx, "acme-legacy")).toMatchObject({ alive: true, port: legacy.port });
      // another account whose state file points at acme-legacy's Chrome: not ours, never adopted or closed
      fs.mkdirSync(profileDir(ctx, "acme-other"), { recursive: true });
      fs.writeFileSync(path.join(profileDir(ctx, "acme-other"), "mkt-browser.json"), JSON.stringify({ port: legacy.port, pid: legacy.pid }));
      expect((await chromeStatus(ctx, "acme-other")).alive).toBe(false);
      expect(await closeChrome(ctx, "acme-other")).toBe(false);
      expect(await isAlive(legacy.port)).toBe(true);
      expect(await closeChrome(ctx, "acme-legacy")).toBe(true);
      expect(await isAlive(legacy.port)).toBe(false);
    } finally {
      try {
        process.kill(legacy.pid);
      } catch {}
    }
  }, 60_000);

  it("an MCP session closes what it opened when the agent goes away", async () => {
    const cfg = path.join(ctx.ws, "mkt.config.yaml");
    fs.writeFileSync(cfg, "quietHours: null\nbrowser:\n  headless: true\n  settleMs: 50\n");
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StdioClientTransport({ command: path.join(ROOT, "bin", "mkt"), args: ["mcp"], env: { ...(process.env as Record<string, string>), MKT_WORKSPACE: ctx.ws, MKT_CONFIG: cfg }, stderr: "pipe" }));
    await client.callTool({ name: "browser_open", arguments: { account: "research", url: `${base}/researching` } });
    const st = await chromeStatus(ctx, "research");
    expect(await allTabs("research")).toEqual([`${base}/researching`]);
    await client.close(); // the agent session ends
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await isAlive(st.port!))) await new Promise((r) => setTimeout(r, 300));
    expect(await isAlive(st.port!)).toBe(false); // its only tab closed, then Chrome
  }, 60_000);
});
