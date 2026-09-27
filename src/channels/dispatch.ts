import { adapterFor, AdapterError, type AdapterEnv, type SendResult } from "../browser/adapters/index.js";
import { resolveMedia } from "../browser/adapters/helpers.js";
import { getPage, goto, shotPath } from "../browser/chrome.js";
import { getAccount } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { getContent, updateContent } from "../core/content.js";
import { beginSend, dueOutbox, finishSend, recordDryRun, recoverStuck } from "../core/outbox.js";
import type { Account, OutboxItem } from "../core/schemas.js";
import { audit } from "../core/store.js";
import { composeEmailText, sendSmtp } from "./email.js";
import { sendWhatsappCloud } from "./whatsapp-cloud.js";

export interface DispatchResult {
  id: string;
  status: "sent" | "failed" | "blocked" | "deferred" | "skipped" | "dry_run";
  reason?: string;
  retryAt?: string;
  url?: string;
  screenshot?: string;
  note?: string;
}

/** Media for a post: the item's own, else the linked content item's. */
function mediaFor(ctx: Ctx, item: OutboxItem): string[] {
  let media = item.media;
  if (!media.length && item.contentId) {
    try {
      media = getContent(ctx, item.brand, item.contentId).media;
    } catch {}
  }
  return resolveMedia(ctx, item.brand, media);
}

export async function sendVia(ctx: Ctx, account: Account & { brand: string }, item: OutboxItem, dryRun: boolean, keepOpen = false): Promise<SendResult> {
  const media = mediaFor(ctx, item);
  if (account.transport === "smtp") return sendSmtp(ctx, account, item, { dryRun, media });
  if (account.transport === "whatsapp_cloud") return sendWhatsappCloud(account, item, { dryRun });

  const adapter = adapterFor(account.platform);
  const page = await getPage(ctx, account.id, { newTab: true });
  const shot = async (label: string) => {
    const p = shotPath(ctx, account.id, `${item.id}-${label}`);
    await page.screenshot({ path: p }).catch(() => {});
    return p;
  };
  const env: AdapterEnv = { ctx, account, page, dryRun, shot, log: (m) => audit(ctx, "adapter.log", { brand: item.brand, ref: item.id, detail: { m } }), goto: (u) => goto(ctx, page, u) };
  let keep = false;
  try {
    await env.goto(adapter.homeUrl);
    if (!(await adapter.isLoggedIn(env))) throw new AdapterError("login", `${account.id} is not logged in: run  mkt browser open ${account.id}  and log in`);
    const to = item.to ?? {};
    const unsupported = () => {
      throw new AdapterError("unsupported", `the ${account.platform} adapter cannot do "${item.kind}" yet: do it by hand (outbox_claim + browser tools, playbook skills/browser-ops/references/platforms/${account.platform}.md)`);
    };
    let r: SendResult;
    switch (item.kind) {
      case "post":
        r = adapter.post ? await adapter.post(env, { text: item.body, media, title: item.subject }) : unsupported();
        break;
      case "dm":
        r = adapter.dm ? await adapter.dm(env, { to, text: item.body, media }) : unsupported();
        break;
      case "reply":
        r = adapter.reply ? await adapter.reply(env, { to, text: item.body, media }) : adapter.dm ? await adapter.dm(env, { to, text: item.body, media }) : unsupported();
        break;
      case "comment":
        r = adapter.comment ? await adapter.comment(env, { url: to.url!, text: item.body }) : unsupported();
        break;
      case "connect":
        r = adapter.connect ? await adapter.connect(env, { to, note: item.body || undefined }) : unsupported();
        break;
      case "email":
        r = adapter.email ? await adapter.email(env, { to, subject: item.subject ?? "", text: composeEmailText(ctx, item) }) : unsupported();
        break;
    }
    // a dry run can leave the filled composer open for a human to look at, when asked; otherwise the screenshot is enough
    keep = dryRun && keepOpen && !ctx.config.browser.headless;
    return r!;
  } catch (e: any) {
    const screenshot = e instanceof AdapterError && e.screenshot ? e.screenshot : await shot("error");
    const err = new AdapterError(e instanceof AdapterError ? e.step : "send", e instanceof AdapterError ? e.message.replace(/^[^:]+: /, "") : e.message, screenshot);
    throw err;
  } finally {
    if (!keep) await page.close().catch(() => {});
  }
}

export async function dispatchOne(ctx: Ctx, id: string, opts: { dryRun?: boolean; keepOpen?: boolean; now?: Date } = {}): Promise<DispatchResult> {
  const dryRun = !!opts.dryRun;
  const b = beginSend(ctx, id, { dryRun, now: opts.now });
  if (!b.ok) {
    const p = b.policy;
    if (b.skipped || p.ok) return { id, status: "skipped", reason: b.skipped };
    return { id, status: p.block ? "blocked" : "deferred", reason: p.reason, retryAt: p.retryAt };
  }
  const account = getAccount(ctx, b.item.account);
  try {
    const r = await sendVia(ctx, account, b.item, dryRun, !!opts.keepOpen);
    if (dryRun) {
      recordDryRun(ctx, id, { screenshot: r.screenshot, note: r.note });
      return { id, status: "dry_run", note: r.note, screenshot: r.screenshot };
    }
    const it = finishSend(ctx, id, b.token, { ok: true, ...r });
    if (it.kind === "post" && it.contentId) markPublished(ctx, it);
    return { id, status: "sent", url: r.url, note: r.note, screenshot: r.screenshot };
  } catch (e: any) {
    if (dryRun) {
      recordDryRun(ctx, id, { screenshot: e.screenshot, note: `dry run failed: ${e.message}` });
      return { id, status: "failed", reason: e.message, screenshot: e.screenshot };
    }
    finishSend(ctx, id, b.token, { ok: false, error: e.message, screenshot: e.screenshot });
    return { id, status: "failed", reason: e.message, screenshot: e.screenshot };
  }
}

function markPublished(ctx: Ctx, it: OutboxItem): void {
  try {
    const c = getContent(ctx, it.brand, it.contentId!);
    const published = [...c.published, { account: it.account, url: it.result?.url, at: it.sentAt ?? new Date().toISOString() }];
    const pending = c.accounts.filter((a) => !published.some((p) => p.account === a));
    updateContent(ctx, it.brand, c.id, { published, status: pending.length ? c.status : "published" });
  } catch {}
}

/** Send everything that is approved and due, one account at a time, oldest first. */
export async function dispatchDue(ctx: Ctx, opts: { now?: Date; limit?: number } = {}): Promise<DispatchResult[]> {
  const now = opts.now ?? new Date();
  recoverStuck(ctx, 20, now);
  const due = dueOutbox(ctx, now).slice(0, opts.limit ?? 50);
  const byAccount = new Map<string, OutboxItem[]>();
  for (const it of due) byAccount.set(it.account, [...(byAccount.get(it.account) ?? []), it]);
  const results: DispatchResult[] = [];
  for (const items of byAccount.values()) {
    for (const it of items) {
      const r = await dispatchOne(ctx, it.id, { now: new Date() });
      results.push(r);
      // after a deferral on this account (rate limit / gap) the rest of its queue would defer too
      if (r.status === "deferred" && /limit|gap/.test(r.reason ?? "")) break;
    }
  }
  return results;
}
