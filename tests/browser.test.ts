import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clickWhenEnabled, dryRunStop, firstVisible, maybeVisible, typeText } from "../src/browser/adapters/helpers.js";
import { ADAPTERS, type PlatformAdapter } from "../src/browser/adapters/index.js";
import { closeChrome, detachAll, getPage } from "../src/browser/chrome.js";
import { locatorFor, snapshot } from "../src/browser/snapshot.js";
import { dispatchOne } from "../src/channels/dispatch.js";
import { createContent } from "../src/core/content.js";
import { approveOutbox, draftOutbox, getOutbox } from "../src/core/outbox.js";
import { renderContent } from "../src/render/carousel.js";
import { human, makeWs } from "./helpers.js";

/** Launches real headless Chrome: run with `npm run test:browser`. */
const run = process.env.MKT_BROWSER_TESTS === "1" ? describe : describe.skip;

run("browser (headless Chrome)", () => {
  // no gap between posts: several tests post on the same fake account
  const ctx = makeWs({ browser: { headless: true, settleMs: 100 }, limits: { threads: { post: { perDay: 100, minGapSec: 0 } } } });
  fs.appendFileSync(`${ctx.ws}/brands/acme/accounts.yaml`, `  - { id: acme-threads, platform: threads, handle: acme }\n`);
  const posts: string[] = [];
  let base = "";
  let server: http.Server;
  const original = ADAPTERS.threads;

  const PAGE = `<!doctype html><title>FakeSocial</title><main>
    <textarea aria-label="What's new" oninput="document.getElementById('go').disabled=!this.value"></textarea>
    <button id="go" disabled onclick="fetch('/post',{method:'POST',body:document.querySelector('textarea').value}).then(()=>{document.body.insertAdjacentHTML('beforeend','<p>Posted!</p>')})">Publicar</button>
  </main>`;

  const fake: PlatformAdapter = {
    platform: "threads",
    homeUrl: "",
    loginUrl: "",
    async isLoggedIn(env) {
      return !!(await maybeVisible(env.page, [(p) => p.getByRole("textbox", { name: "What's new" })], 3000));
    },
    async post(env, input) {
      await typeText(env.page, "compose", [(p) => p.getByRole("textbox", { name: "What's new" })], input.text);
      if (env.dryRun) return dryRunStop(env, "post");
      await clickWhenEnabled(env.page, "submit", [(p) => p.getByRole("button", { name: /^(Post|Publicar)$/ })]);
      await firstVisible(env.page, "verify", [(p) => p.getByText("Posted!")]);
      return { url: `${base}/p/${posts.length}`, note: "posted" };
    },
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          posts.push(body);
          res.end("ok");
        });
        return;
      }
      res.setHeader("content-type", "text/html");
      res.end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    fake.homeUrl = `${base}/`;
    ADAPTERS.threads = fake;
  });

  afterAll(async () => {
    ADAPTERS.threads = original;
    await closeChrome(ctx, "acme-threads");
    await detachAll();
    server.close();
  });

  it("snapshot refs drive clicks and typing", async () => {
    const page = await getPage(ctx, "acme-threads", { url: `${base}/` });
    const snap = await snapshot(page);
    const box = snap.match(/\[(e\d+)\] textbox "What's new"/)![1];
    expect(snap).toMatch(/button "Publicar" \(disabled\)/);
    await locatorFor(page, box).fill("hello");
    expect(await snapshot(page)).toMatch(/button "Publicar"\s*$/m);
  }, 60_000);

  it("dispatch: dry run fills without posting, then an approved send posts once and is recorded", async () => {
    const d = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-threads", body: "Launch day \u{1F680}\nsecond line" });
    const dry = await dispatchOne(ctx, d.id, { dryRun: true });
    expect(dry.status).toBe("dry_run");
    expect(fs.existsSync(dry.screenshot!)).toBe(true);
    expect(posts).toHaveLength(0);
    expect(getOutbox(ctx, d.id).status).toBe("pending_approval");

    expect((await dispatchOne(ctx, d.id)).status).toBe("skipped"); // not approved yet
    approveOutbox(human(ctx), [d.id]);
    const sent = await dispatchOne(ctx, d.id);
    expect(sent).toMatchObject({ status: "sent", url: `${base}/p/1` });
    expect(posts).toEqual(["Launch day \u{1F680}\nsecond line"]);
    expect(getOutbox(ctx, d.id)).toMatchObject({ status: "sent", result: { url: `${base}/p/1` } });
    expect((await dispatchOne(ctx, d.id)).status).toBe("skipped"); // never twice
  }, 90_000);

  it("adapter failures become failed items with a screenshot", async () => {
    ADAPTERS.threads = { ...fake, post: async (env) => (await firstVisible(env.page, "compose", ["#does-not-exist"], 500), {}) };
    try {
      const d = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-threads", body: "x" });
      approveOutbox(human(ctx), [d.id]);
      const r = await dispatchOne(ctx, d.id);
      expect(r.status).toBe("failed");
      expect(r.reason).toMatch(/compose/);
      expect(fs.existsSync(r.screenshot!)).toBe(true);
    } finally {
      ADAPTERS.threads = fake;
    }
  }, 60_000);

  it("inbox sync logs scraped chats once, skips our own sends and handles opt-outs", async () => {
    const threads = [
      { contact: { name: "Ana Souza" }, unread: true, messages: [{ direction: "out" as const, text: "Launch day \u{1F680}\nsecond line" }, { direction: "in" as const, text: "Quanto custa?" }, { direction: "in" as const, text: "ok" }] },
      { contact: { name: "Bruno" }, unread: true, messages: [{ direction: "in" as const, text: "ok" }] },
      { contact: { handle: "@troll" }, unread: true, messages: [{ direction: "in" as const, text: "STOP" }] },
    ];
    ADAPTERS.threads = { ...fake, readInbox: async () => threads };
    const { syncAccount } = await import("../src/inbox/sync.js");
    const { listThreads, logMessages } = await import("../src/core/conversations.js");
    const { isSuppressed } = await import("../src/core/identity.js");
    try {
      // pretend our outbox already sent Ana the first message
      logMessages(ctx, "acme", [{ brand: "acme", account: "acme-threads", platform: "threads", contact: { name: "Ana Souza" }, direction: "out", text: "Launch day \u{1F680}\nsecond line" }]);
      const first = await syncAccount(ctx, "acme-threads");
      expect(first).toMatchObject({ added: 4, optOuts: 1 });
      const again = await syncAccount(ctx, "acme-threads");
      expect(again.added).toBe(0);
      const keys = listThreads(ctx, "acme", { platform: "threads" }).map((t) => t.threadKey).sort();
      expect(keys).toEqual(["threads:name:ana souza", "threads:name:bruno", "threads:troll"]);
      expect(isSuppressed(ctx, ["threads:troll"])).toBeTruthy();
    } finally {
      ADAPTERS.threads = fake;
    }
  }, 60_000);

  it("renders carousel slides", async () => {
    const c = createContent(ctx, "acme", { title: "t", format: "carousel", body: "## Slides\n\n### Hook **here**\nsub\n\n### 2\nPoint\n- a\n\n## Caption\nx" });
    const files = await renderContent(ctx, "acme", c.id);
    expect(files).toHaveLength(2);
    expect(fs.statSync(files[0]).size).toBeGreaterThan(5000);
  }, 60_000);
});
