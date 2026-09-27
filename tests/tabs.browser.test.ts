import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dryRunStop, typeText } from "../src/browser/adapters/helpers.js";
import { ADAPTERS, type PlatformAdapter } from "../src/browser/adapters/index.js";
import { chromeStatus, closeChrome, closeOwnedTabs, detachAll, getPage, isAlive, ownedPages } from "../src/browser/chrome.js";
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
    for (const a of ["acme-x", "acme-threads", "acme-ig"]) await closeChrome(ctx, a);
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
