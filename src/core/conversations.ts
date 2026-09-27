import crypto from "node:crypto";
import type { Ctx } from "./config.js";
import { detectOptOut, normEmail, normHandle, normPhone, recipientIds, suppress } from "./identity.js";
import { findLeadBy, updateLead } from "./leads.js";
import { Insight, Message, type Platform, type Recipient } from "./schemas.js";
import { appendJsonl, assertBrand, audit, brandFile, newId, nowIso, readJsonl, updateJson, withLock } from "./store.js";

const convFile = (ctx: Ctx, brand: string) => brandFile(ctx, brand, "conversations.jsonl");
const insightsFile = (ctx: Ctx, brand: string) => brandFile(ctx, brand, "insights.jsonl");

export function threadKey(platform: string, c: { email?: string; phone?: string; handle?: string; url?: string; name?: string }): string {
  if (platform === "email" && c.email) return `email:${normEmail(c.email)}`;
  if (platform === "whatsapp" && c.phone) return `whatsapp:${normPhone(c.phone)}`;
  if (c.handle) return `${platform}:${normHandle(c.handle)}`;
  if (c.email) return `${platform}:${normEmail(c.email)}`;
  if (c.phone) return `${platform}:${normPhone(c.phone)}`;
  if (c.url) return `${platform}:${normHandle(c.url)}`;
  // saved WhatsApp contacts often expose only a display name
  if (c.name) return `${platform}:name:${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return `${platform}:unknown`;
}

export function recipientThreadKey(platform: Platform, to?: Recipient): string | undefined {
  return to ? threadKey(platform, to) : undefined;
}

export type MessageInput = Omit<Message, "id" | "flags" | "threadKey" | "at"> & { threadKey?: string; at?: string; flags?: string[] };

/**
 * Append messages, skipping ones we already have (same externalId, or same thread + direction + text within a
 * minute). Inbound messages update the lead and trigger opt-out handling. Returns only the new ones.
 */
export function logMessages(ctx: Ctx, brand: string, inputs: MessageInput[]): Message[] {
  assertBrand(ctx, brand);
  const file = convFile(ctx, brand);
  const added: Message[] = [];
  withLock(file, () => {
    const existing = readJsonl<Message>(file);
    const seen = new Set(existing.map(dedupeKey));
    for (const i of inputs) {
      const m = Message.parse({
        ...i,
        id: newId("msg"),
        brand,
        threadKey: i.threadKey ?? threadKey(i.platform, i.contact),
        at: i.at ?? nowIso(),
        flags: i.flags ?? [],
      });
      const k = dedupeKey(m);
      if (seen.has(k)) continue;
      seen.add(k);
      if (m.direction === "in") {
        const signal = detectOptOut(m.text);
        if (signal) m.flags = [...new Set([...m.flags, signal])];
        if (!m.leadId) m.leadId = findLeadBy(ctx, brand, { ...m.contact, platform: m.platform })?.id;
      }
      added.push(m);
    }
    appendJsonl(file, ...added);
  });
  for (const m of added.filter((m) => m.direction === "in")) onInbound(ctx, brand, m);
  return added;
}

function dedupeKey(m: Message): string {
  if (m.externalId) return `x:${m.platform}:${m.externalId}`;
  const minute = m.at.slice(0, 16);
  return `h:${m.threadKey}:${m.direction}:${minute}:${crypto.createHash("sha1").update(m.text.trim()).digest("hex").slice(0, 12)}`;
}

function onInbound(ctx: Ctx, brand: string, m: Message): void {
  if (m.leadId) {
    try {
      const patch: Parameters<typeof updateLead>[3] = { lastInboundAt: m.at };
      if (m.flags.includes("opt_out")) patch.stage = "do_not_contact";
      else if (m.flags.includes("not_interested")) patch.stage = "lost";
      updateLead({ ...ctx, actor: "system:inbox" }, brand, m.leadId, patch);
      if (!m.flags.length) promoteToReplied(ctx, brand, m.leadId);
    } catch {}
  }
  if (m.flags.includes("opt_out")) {
    const ids = recipientIds(m.platform, m.contact);
    if (ids.length) suppress(ctx, ids, `opt-out message: "${m.text.slice(0, 120)}"`, `inbox:${m.account}`);
  }
  if (m.flags.includes("opt_out") || m.flags.includes("not_interested")) cancelPendingFor(ctx, brand, m);
}

function promoteToReplied(ctx: Ctx, brand: string, leadId: string): void {
  updateJson<any[]>(brandFile(ctx, brand, "leads.json"), [], (leads) => {
    const l = leads.find((x) => x.id === leadId);
    if (l && ["new", "researched", "contacted"].includes(l.stage)) (l.stage = "replied"), (l.updatedAt = nowIso());
  });
}

/** Stop anything queued for someone who just said no. */
function cancelPendingFor(ctx: Ctx, brand: string, m: Message): void {
  const cancelled: string[] = [];
  updateJson<any[]>(brandFile(ctx, brand, "outbox.json"), [], (items) => {
    for (const it of items) {
      if (!["draft", "pending_approval", "approved"].includes(it.status) || it.kind === "post") continue;
      const same = (m.leadId && it.to?.leadId === m.leadId) || (it.to && threadKey(it.platform, it.to) === m.threadKey);
      if (!same) continue;
      it.status = "cancelled";
      it.lastError = `cancelled: contact replied ${m.flags.join(",")}`;
      it.updatedAt = nowIso();
      cancelled.push(it.id);
    }
  });
  if (cancelled.length) audit(ctx, "outbox.cancel_on_optout", { brand, ref: m.threadKey, detail: { ids: cancelled } });
}

export interface ThreadSummary {
  threadKey: string;
  platform: string;
  account: string;
  contact: Message["contact"];
  leadId?: string;
  lastAt: string;
  lastDirection: "in" | "out";
  lastText: string;
  messages: number;
  needsReply: boolean;
  flags: string[];
}

export function listThreads(ctx: Ctx, brand: string, f: { needsReply?: boolean; platform?: string; account?: string; since?: string; limit?: number } = {}): ThreadSummary[] {
  assertBrand(ctx, brand);
  const byThread = new Map<string, ThreadSummary>();
  for (const m of readJsonl<Message>(convFile(ctx, brand))) {
    const t = byThread.get(m.threadKey);
    if (!t) {
      byThread.set(m.threadKey, {
        threadKey: m.threadKey, platform: m.platform, account: m.account, contact: m.contact, leadId: m.leadId, lastAt: m.at,
        lastDirection: m.direction, lastText: m.text, messages: 1, needsReply: m.direction === "in", flags: [...m.flags],
      });
      continue;
    }
    t.messages++;
    t.contact = { ...t.contact, ...Object.fromEntries(Object.entries(m.contact).filter(([, v]) => v)) };
    t.leadId ??= m.leadId;
    t.flags = [...new Set([...t.flags, ...m.flags])];
    if (m.at >= t.lastAt) Object.assign(t, { lastAt: m.at, lastDirection: m.direction, lastText: m.text, account: m.account });
    t.needsReply = t.lastDirection === "in" && !t.flags.includes("opt_out");
  }
  let out = [...byThread.values()];
  if (f.needsReply != null) out = out.filter((t) => t.needsReply === f.needsReply);
  if (f.platform) out = out.filter((t) => t.platform === f.platform);
  if (f.account) out = out.filter((t) => t.account === f.account);
  if (f.since) out = out.filter((t) => t.lastAt >= f.since!);
  out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return f.limit ? out.slice(0, f.limit) : out;
}

export function getThread(ctx: Ctx, brand: string, key: string, limit = 50): Message[] {
  assertBrand(ctx, brand);
  return readJsonl<Message>(convFile(ctx, brand))
    .filter((m) => m.threadKey === key)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-limit);
}

/** True when this contact wrote to us first (so a reply is not cold outreach). */
export function hasInbound(ctx: Ctx, brand: string, key: string): boolean {
  return readJsonl<Message>(convFile(ctx, brand)).some((m) => m.threadKey === key && m.direction === "in");
}

// ---------------------------------------------------------------- insights

export function addInsights(ctx: Ctx, brand: string, inputs: Omit<Insight, "id" | "brand" | "at">[]): Insight[] {
  assertBrand(ctx, brand);
  const rows = inputs.map((i) => Insight.parse({ ...i, id: newId("in"), brand, at: nowIso() }));
  appendJsonl(insightsFile(ctx, brand), ...rows);
  audit(ctx, "insight.add", { brand, detail: { count: rows.length } });
  return rows;
}

export function listInsights(ctx: Ctx, brand: string, f: { persona?: string; kind?: string[]; q?: string; since?: string; limit?: number } = {}): Insight[] {
  assertBrand(ctx, brand);
  let rows = readJsonl<Insight>(insightsFile(ctx, brand));
  if (f.persona) rows = rows.filter((r) => !r.persona || r.persona === f.persona);
  if (f.kind?.length) rows = rows.filter((r) => f.kind!.includes(r.kind));
  if (f.since) rows = rows.filter((r) => r.at >= f.since!);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((r) => `${r.text} ${r.quote ?? ""}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => b.weight - a.weight || b.at.localeCompare(a.at));
  return rows.slice(0, f.limit ?? 50);
}

