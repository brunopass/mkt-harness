import { approvalRequired, limitFor, type Ctx } from "./config.js";
import { getAccount, getBrand } from "./brands.js";
import { hasInbound, threadKey } from "./conversations.js";
import { isSuppressed, recipientIds } from "./identity.js";
import { COLD_KINDS, type Lead, type OutboxItem } from "./schemas.js";
import { appendJsonl, brandFile, readJson, readJsonl, stateFile } from "./store.js";
import { inQuietHours, quietHoursEnd } from "./time.js";

export type PolicyResult =
  | { ok: true }
  /** block: permanent until a human changes something. defer: try again at retryAt. */
  | { ok: false; block: boolean; reason: string; retryAt?: string };

interface SendRecord {
  id: string;
  account: string;
  kind: string;
  at: string;
}

const sendsFile = (ctx: Ctx) => stateFile(ctx, "sends.jsonl");

export function recordSend(ctx: Ctx, item: Pick<OutboxItem, "id" | "account" | "kind">, at = new Date()): void {
  appendJsonl(sendsFile(ctx), { id: item.id, account: item.account, kind: item.kind, at: at.toISOString() });
}

export function recentSends(ctx: Ctx, account: string, kind: string, now = new Date()): SendRecord[] {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  return readJsonl<SendRecord>(sendsFile(ctx)).filter((s) => s.account === account && s.kind === kind && s.at > since);
}

function leadFor(ctx: Ctx, item: OutboxItem): Lead | undefined {
  if (!item.to?.leadId) return undefined;
  return readJson<Lead[]>(brandFile(ctx, item.brand, "leads.json"), []).find((l) => l.id === item.to!.leadId);
}

/** Every identifier this send could reach: the explicit recipient plus the lead's own contact points. */
function allRecipientIds(item: OutboxItem, lead?: Lead): string[] {
  const ids = recipientIds(item.platform, item.to);
  if (lead) {
    ids.push(...recipientIds(item.platform, { email: lead.email, phone: lead.phone, handle: lead.handles[item.platform] }));
  }
  return [...new Set(ids)];
}

export function checkPolicy(ctx: Ctx, item: OutboxItem, now = new Date()): PolicyResult {
  const block = (reason: string): PolicyResult => ({ ok: false, block: true, reason });
  const defer = (reason: string, retryAt: Date): PolicyResult => ({ ok: false, block: false, reason, retryAt: retryAt.toISOString() });

  const account = getAccount(ctx, item.account);
  if (!account.active) return block(`account ${account.id} is inactive`);
  if (account.brand !== item.brand) return block(`account ${account.id} belongs to brand ${account.brand}, not ${item.brand}`);
  if (account.platform !== item.platform) return block(`account ${account.id} is ${account.platform}, item says ${item.platform}`);
  if (approvalRequired(ctx, item.kind) && !item.approval) return { ok: false, block: false, reason: "awaiting human approval" };

  if (item.kind !== "post") {
    if (!item.to) return block(`${item.kind} needs a recipient (to)`);
    const lead = leadFor(ctx, item);
    if (item.to.leadId && !lead) return block(`lead ${item.to.leadId} not found`);
    if (lead?.stage === "do_not_contact") return block(`lead ${lead.id} is do_not_contact`);
    const sup = isSuppressed(ctx, allRecipientIds(item, lead));
    if (sup) return block(`recipient suppressed (${sup.id}: ${sup.reason})`);

    const key = threadKey(item.platform, item.to);
    const repliedEver = hasInbound(ctx, item.brand, key) || !!lead?.lastInboundAt;
    const repliedSinceLastTouch = !!lead?.lastInboundAt && (!lead.lastContactAt || lead.lastInboundAt > lead.lastContactAt);

    if (item.kind === "reply" && !repliedEver)
      return block("a reply needs an inbound message from this contact first; use dm/email/connect for first contact");
    if (item.kind === "comment" && !item.to.url) return block("comment needs to.url (the post to comment on)");

    const cold = COLD_KINDS.includes(item.kind);
    if (cold && !repliedEver) {
      if (item.platform === "whatsapp" && lead?.consent.whatsapp !== "opt_in")
        return block("first WhatsApp contact needs a lead with consent.whatsapp = opt_in");
      if (item.platform === "email" && (!lead || lead.consent.email === "none"))
        return block("cold email needs a lead with consent.email = legitimate_interest or opt_in (and consent.basis)");
    }
    if (cold && lead && !repliedSinceLastTouch) {
      const max = ctx.config.outreach.maxTouchesPerLead;
      if (lead.touches >= max) return block(`lead ${lead.id} got ${lead.touches} touches without a reply (max ${max})`);
      if (lead.lastContactAt) {
        const next = new Date(Date.parse(lead.lastContactAt) + ctx.config.outreach.minHoursBetweenTouches * 3_600_000);
        if (next > now) return defer(`last touch ${lead.lastContactAt}; spacing ${ctx.config.outreach.minHoursBetweenTouches}h`, next);
      }
    }
    if (cold) {
      const tz = getBrand(ctx, item.brand).timezone;
      if (inQuietHours(now, tz, ctx.config.quietHours))
        return defer(`quiet hours in ${tz}`, quietHoursEnd(now, tz, ctx.config.quietHours));
    }
  }

  const limit = limitFor(ctx, item.platform, item.kind, account.limits);
  const recent = recentSends(ctx, item.account, item.kind, now).sort((a, b) => a.at.localeCompare(b.at));
  if (recent.length >= limit.perDay) {
    const oldest = Date.parse(recent[recent.length - limit.perDay].at);
    return defer(`${item.account} sent ${recent.length} ${item.kind} in 24h (limit ${limit.perDay})`, new Date(oldest + 86_400_000 + 1000));
  }
  const last = recent.at(-1);
  if (last && now.getTime() - Date.parse(last.at) < limit.minGapSec * 1000)
    return defer(`min gap ${limit.minGapSec}s between ${item.kind} on ${item.account}`, new Date(Date.parse(last.at) + limit.minGapSec * 1000));

  return { ok: true };
}

export function policyStatus(ctx: Ctx, accountId: string, now = new Date()) {
  const account = getAccount(ctx, accountId);
  const tz = getBrand(ctx, account.brand).timezone;
  const kinds = ["post", "dm", "reply", "comment", "connect", "email"];
  return {
    account: account.id,
    platform: account.platform,
    active: account.active,
    timezone: tz,
    quietHoursNow: inQuietHours(now, tz, ctx.config.quietHours),
    quota: Object.fromEntries(
      kinds.map((k) => {
        const l = limitFor(ctx, account.platform, k, account.limits);
        const used = recentSends(ctx, account.id, k, now).length;
        return [k, { used24h: used, perDay: l.perDay, remaining: Math.max(0, l.perDay - used), minGapSec: l.minGapSec }];
      }),
    ),
  };
}
