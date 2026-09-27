import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { adapterFor, AdapterError, type AdapterEnv } from "../browser/adapters/index.js";
import { getPage, goto, shotPath } from "../browser/chrome.js";
import { getAccount, listAccounts } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { getThread, logMessages, threadKey, type MessageInput } from "../core/conversations.js";
import type { Account } from "../core/schemas.js";
import { audit, MktError, readJson, stateFile, writeJson } from "../core/store.js";

export interface SyncResult {
  account: string;
  fetched: number;
  added: number;
  optOuts: number;
  skipped?: string;
  error?: string;
}

export async function syncAccount(ctx: Ctx, accountId: string, opts: { limit?: number } = {}): Promise<SyncResult> {
  const account = getAccount(ctx, accountId);
  try {
    let inputs: MessageInput[];
    if (account.transport === "smtp") {
      if (!account.email?.imapUrlEnv) return { account: account.id, fetched: 0, added: 0, optOuts: 0, skipped: "no email.imapUrlEnv configured" };
      inputs = await readImap(ctx, account, opts.limit ?? 50);
    } else if (account.transport === "whatsapp_cloud") {
      return { account: account.id, fetched: 0, added: 0, optOuts: 0, skipped: "Cloud API inbound needs a webhook (not polled); use a WhatsApp Web account for inbox" };
    } else {
      inputs = await readBrowserInbox(ctx, account, opts.limit ?? 20);
    }
    const added = logMessages(ctx, account.brand, inputs);
    const optOuts = added.filter((m) => m.flags.includes("opt_out")).length;
    audit(ctx, "inbox.sync", { brand: account.brand, ref: account.id, detail: { fetched: inputs.length, added: added.length, optOuts } });
    return { account: account.id, fetched: inputs.length, added: added.length, optOuts };
  } catch (e: any) {
    audit(ctx, "inbox.sync_failed", { brand: account.brand, ref: account.id, detail: { error: e.message } });
    return { account: account.id, fetched: 0, added: 0, optOuts: 0, error: e.message };
  }
}

/** Accounts flagged `inbox: true` (optionally for one brand). */
export async function syncAll(ctx: Ctx, brand?: string): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const a of listAccounts(ctx, brand).filter((a) => a.inbox && a.active)) out.push(await syncAccount(ctx, a.id));
  return out;
}

// ---------------------------------------------------------------- browser inboxes

async function readBrowserInbox(ctx: Ctx, account: Account & { brand: string }, limit: number): Promise<MessageInput[]> {
  const adapter = adapterFor(account.platform);
  if (!adapter.readInbox) throw new MktError(`the ${account.platform} adapter cannot read the inbox yet`);
  const page = await getPage(ctx, account.id, { newTab: true });
  const env: AdapterEnv = {
    ctx, account, page, dryRun: true,
    shot: async (label) => {
      const p = shotPath(ctx, account.id, `inbox-${label}`);
      await page.screenshot({ path: p }).catch(() => {});
      return p;
    },
    log: () => {},
    goto: (u) => goto(ctx, page, u),
  };
  try {
    await env.goto(adapter.homeUrl);
    if (!(await adapter.isLoggedIn(env))) throw new AdapterError("login", `${account.id} is not logged in: mkt browser open ${account.id}`);
    const threads = await adapter.readInbox(env, { limit, unreadOnly: false });
    const now = Date.now();
    const out: MessageInput[] = [];
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const t of threads) {
      const key = threadKey(account.platform, t.contact);
      const known = getThread(ctx, account.brand, key, 500);
      const sentByUs = new Set(known.filter((m) => m.direction === "out").map((m) => norm(m.text)));
      t.messages.forEach((m, i) => {
        // what we sent through the outbox is already logged
        if (m.direction === "out" && sentByUs.has(norm(m.text))) return;
        // scraped chats rarely carry ids or timestamps: derive a stable id from the thread, the text and the message
        // before it (so re-reading the same window next sync dedupes), and keep order with synthetic times
        const prev = t.messages[i - 1]?.text ?? "";
        const externalId = m.externalId ?? `h:${crypto.createHash("sha1").update(`${key}|${m.direction}|${norm(prev)}|${norm(m.text)}`).digest("hex").slice(0, 16)}`;
        const at = m.at ?? new Date(now - (t.messages.length - i) * 1000).toISOString();
        out.push({ brand: account.brand, account: account.id, platform: account.platform, threadKey: key, contact: t.contact, direction: m.direction, text: m.text, at, url: t.url, externalId });
      });
    }
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- IMAP

interface ImapState {
  uidValidity?: string;
  lastUid?: number;
}

export function parseImapUrl(url: string): { host: string; port: number; secure: boolean; user: string; pass: string } {
  const u = new URL(url);
  if (!/^imaps?:$/.test(u.protocol)) throw new MktError("IMAP url must be imaps://user:pass@host:993 or imap://...");
  const secure = u.protocol === "imaps:";
  return { host: u.hostname, port: u.port ? +u.port : secure ? 993 : 143, secure, user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) };
}

/** Keep the new part of a reply: drop quoted history and signatures' reply headers. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^(On|Em|El|Le|Il|Am) .{4,200}(wrote|escreveu|escribi[óo]|a écrit|ha scritto|schrieb):\s*$/i.test(l.trim())) break;
    if (/^-{2,}\s*(Original Message|Mensagem original|Mensaje original)/i.test(l.trim())) break;
    if (/^_{5,}$/.test(l.trim())) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

async function readImap(ctx: Ctx, account: Account & { brand: string }, limit: number): Promise<MessageInput[]> {
  const url = process.env[account.email!.imapUrlEnv!];
  if (!url) throw new MktError(`env var ${account.email!.imapUrlEnv} is not set`);
  const cfg = parseImapUrl(url);
  const own = (account.email?.from.match(/<([^>]+)>/)?.[1] ?? account.email?.from ?? cfg.user).toLowerCase();
  const sf = stateFile(ctx, `inbox-${account.id}.json`);
  const st = readJson<ImapState>(sf, {});
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  await client.connect();
  const out: MessageInput[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const mb = client.mailbox;
    const validity = mb && typeof mb === "object" ? String(mb.uidValidity) : undefined;
    let uids: number[];
    if (st.lastUid && st.uidValidity === validity) {
      uids = ((await client.search({ uid: `${st.lastUid + 1}:*` }, { uid: true })) || []).filter((u) => u > st.lastUid!);
    } else {
      uids = (await client.search({ since: new Date(Date.now() - 14 * 86_400_000) }, { uid: true })) || [];
    }
    uids = uids.sort((a, b) => a - b).slice(-limit);
    let maxUid = st.lastUid ?? 0;
    if (uids.length) {
      for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        maxUid = Math.max(maxUid, msg.uid);
        if (!msg.source) continue;
        const p = await simpleParser(msg.source);
        const from = p.from?.value?.[0];
        if (!from?.address || from.address.toLowerCase() === own) continue;
        const text = stripQuoted(p.text ?? "");
        out.push({
          brand: account.brand, account: account.id, platform: "email", contact: { email: from.address, name: from.name || undefined },
          direction: "in", text: text || "(empty)", subject: p.subject, at: (p.date ?? new Date()).toISOString(), externalId: p.messageId,
        });
      }
    }
    writeJson(sf, { uidValidity: validity, lastUid: maxUid } satisfies ImapState);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}
