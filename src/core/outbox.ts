import crypto from "node:crypto";
import { approvalRequired, type Ctx } from "./config.js";
import { getAccount, listBrands } from "./brands.js";
import { logMessages } from "./conversations.js";
import { isSuppressed, recipientIds } from "./identity.js";
import { checkPolicy, recordSend, type PolicyResult } from "./policy.js";
import { COLD_KINDS, OutboxItem, type Lead, type OutboxKind, type OutboxStatus, type Recipient } from "./schemas.js";
import { assertBrand, audit, brandFile, MktError, newId, nowIso, readJson, updateJson } from "./store.js";

const outboxFile = (ctx: Ctx, brand: string) => brandFile(ctx, brand, "outbox.json");

export interface DraftInput {
  brand: string;
  kind: OutboxKind;
  account: string;
  to?: Recipient;
  subject?: string;
  body: string;
  media?: string[];
  contentId?: string;
  sequence?: { name: string; step: number };
  rationale?: string;
  scheduledFor?: string;
  /** "draft" keeps it out of the approval queue until someone submits it */
  status?: "draft" | "pending_approval";
}

export function listOutbox(ctx: Ctx, brand?: string, f: { status?: string[]; account?: string; kind?: string; leadId?: string; sequence?: string; limit?: number } = {}): OutboxItem[] {
  const brands = brand ? [brand] : listBrands(ctx);
  let items = brands.flatMap((b) => readJson<OutboxItem[]>(outboxFile(ctx, b), []));
  if (f.status?.length) items = items.filter((i) => f.status!.includes(i.status));
  if (f.account) items = items.filter((i) => i.account === f.account);
  if (f.kind) items = items.filter((i) => i.kind === f.kind);
  if (f.leadId) items = items.filter((i) => i.to?.leadId === f.leadId);
  if (f.sequence) items = items.filter((i) => i.sequence?.name === f.sequence);
  items.sort((a, b) => (a.scheduledFor ?? a.createdAt).localeCompare(b.scheduledFor ?? b.createdAt));
  return f.limit ? items.slice(0, f.limit) : items;
}

export function getOutbox(ctx: Ctx, id: string, brand?: string): OutboxItem {
  const it = listOutbox(ctx, brand).find((i) => i.id === id);
  if (!it) throw new MktError(`outbox item "${id}" not found`);
  return it;
}

function mutate(ctx: Ctx, brand: string, id: string, fn: (it: OutboxItem) => void): OutboxItem {
  let out!: OutboxItem;
  updateJson<OutboxItem[]>(outboxFile(ctx, brand), [], (items) => {
    const it = items.find((i) => i.id === id);
    if (!it) throw new MktError(`outbox item "${id}" not found in ${brand}`);
    fn(it);
    it.updatedAt = nowIso();
    out = OutboxItem.parse(it);
  });
  return out;
}

export function draftOutbox(ctx: Ctx, input: DraftInput): OutboxItem {
  assertBrand(ctx, input.brand);
  const account = getAccount(ctx, input.account);
  if (account.brand !== input.brand) throw new MktError(`account ${account.id} belongs to ${account.brand}`);
  if (input.kind === "email" && account.platform !== "email") throw new MktError(`kind "email" needs an email account`);
  if (input.kind !== "post" && !input.to) throw new MktError(`${input.kind} needs "to"`);
  if (input.kind === "post" && input.to) throw new MktError(`a post has no recipient`);
  const lead = input.to?.leadId
    ? readJson<Lead[]>(brandFile(ctx, input.brand, "leads.json"), []).find((l) => l.id === input.to!.leadId)
    : undefined;
  if (input.to?.leadId && !lead) throw new MktError(`lead ${input.to.leadId} not found`);
  if (lead?.stage === "do_not_contact") throw new MktError(`lead ${lead.id} is do_not_contact`);
  const sup = isSuppressed(ctx, [
    ...recipientIds(account.platform, input.to),
    ...(lead ? recipientIds(account.platform, { email: lead.email, phone: lead.phone, handle: lead.handles[account.platform] }) : []),
  ]);
  if (sup) throw new MktError(`recipient is suppressed (${sup.id}: ${sup.reason})`);

  const at = nowIso();
  const needsApproval = approvalRequired(ctx, input.kind);
  const item = OutboxItem.parse({
    ...input,
    // fill the recipient from the lead so the channel has something to address
    to: input.to && lead ? fillRecipient(input.to, lead, account.platform) : input.to,
    id: newId("ob"),
    platform: account.platform,
    media: input.media ?? [],
    status: input.status ?? (needsApproval ? "pending_approval" : "approved"),
    approval: needsApproval ? undefined : { by: "policy:auto", at },
    attempts: 0,
    createdBy: ctx.actor,
    createdAt: at,
    updatedAt: at,
  });
  updateJson<OutboxItem[]>(outboxFile(ctx, input.brand), [], (items) => void items.push(item));
  audit(ctx, "outbox.draft", { brand: item.brand, ref: item.id, detail: { kind: item.kind, account: item.account, status: item.status } });
  return item;
}

function fillRecipient(to: Recipient, lead: Lead, platform: string): Recipient {
  return {
    ...to,
    name: to.name ?? lead.name,
    email: to.email ?? (platform === "email" ? lead.email : undefined),
    phone: to.phone ?? (platform === "whatsapp" ? lead.phone : undefined),
    handle: to.handle ?? lead.handles[platform],
  };
}

const EDITABLE: OutboxStatus[] = ["draft", "pending_approval", "approved", "failed", "blocked"];

/** Editing the message of an approved item sends it back for approval: approval covers exact words. */
export function updateOutbox(
  ctx: Ctx,
  id: string,
  patch: Partial<Pick<OutboxItem, "body" | "subject" | "media" | "to" | "scheduledFor" | "rationale">> & { submit?: boolean },
): OutboxItem {
  const cur = getOutbox(ctx, id);
  if (!EDITABLE.includes(cur.status)) throw new MktError(`cannot edit ${id}: status ${cur.status}`);
  const it = mutate(ctx, cur.brand, id, (it) => {
    const { submit, ...fields } = patch;
    const contentChanged = ["body", "subject", "media", "to"].some((k) => (fields as any)[k] !== undefined);
    Object.assign(it, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    if (contentChanged && it.approval && it.approval.by !== "policy:auto") {
      it.approval = undefined;
      it.status = "pending_approval";
    }
    if (["failed", "blocked"].includes(it.status) && contentChanged) it.status = it.approval ? "approved" : "pending_approval";
    if (submit && it.status === "draft") it.status = approvalRequired(ctx, it.kind) ? "pending_approval" : "approved";
    it.notBefore = undefined;
  });
  audit(ctx, "outbox.update", { brand: it.brand, ref: id, detail: { fields: Object.keys(patch), status: it.status } });
  return it;
}

export function approveOutbox(ctx: Ctx, ids: string[], note?: string): OutboxItem[] {
  return ids.map((id) => {
    const cur = getOutbox(ctx, id);
    if (!["draft", "pending_approval", "blocked", "failed"].includes(cur.status))
      throw new MktError(`cannot approve ${id}: status ${cur.status}`);
    const it = mutate(ctx, cur.brand, id, (it) => {
      it.status = "approved";
      it.approval = { by: ctx.actor, at: nowIso(), note };
      it.lastError = undefined;
      it.notBefore = undefined;
    });
    audit(ctx, "outbox.approve", { brand: it.brand, ref: id, detail: { note } });
    return it;
  });
}

export function cancelOutbox(ctx: Ctx, id: string, reason: string): OutboxItem {
  const cur = getOutbox(ctx, id);
  if (["sent", "sending", "cancelled"].includes(cur.status)) throw new MktError(`cannot cancel ${id}: status ${cur.status}`);
  const it = mutate(ctx, cur.brand, id, (it) => {
    it.status = "cancelled";
    it.lastError = reason;
  });
  audit(ctx, "outbox.cancel", { brand: it.brand, ref: id, detail: { reason } });
  return it;
}

export function dueOutbox(ctx: Ctx, now = new Date()): OutboxItem[] {
  const t = now.toISOString();
  return listOutbox(ctx, undefined, { status: ["approved"] }).filter((i) => (i.scheduledFor ?? "") <= t && (i.notBefore ?? "") <= t);
}

// ---------------------------------------------------------------- send lifecycle

export type BeginResult =
  | { ok: true; item: OutboxItem; token: string }
  /** skipped: not in a sendable state (not approved, already sent, ...). Otherwise the policy said no. */
  | { ok: false; item: OutboxItem; policy: PolicyResult; skipped?: string };

/**
 * Atomically move an approved item to "sending" if policy allows. The policy check runs inside the outbox lock so
 * two senders cannot both pass a rate limit with the last slot.
 */
export function beginSend(ctx: Ctx, id: string, opts: { now?: Date; by?: string; dryRun?: boolean } = {}): BeginResult {
  const cur = getOutbox(ctx, id);
  const now = opts.now ?? new Date();
  let result!: BeginResult;
  updateJson<OutboxItem[]>(outboxFile(ctx, cur.brand), [], (items) => {
    const it = items.find((i) => i.id === id)!;
    if (it.status !== "approved" && !(opts.dryRun && ["pending_approval", "draft", "approved"].includes(it.status))) {
      const reason = `status is ${it.status}, not approved`;
      result = { ok: false, item: { ...it }, policy: { ok: false, block: false, reason }, skipped: reason };
      return;
    }
    const policy = opts.dryRun ? checkPolicy(ctx, { ...it, approval: it.approval ?? { by: "dry-run", at: now.toISOString() } }, now) : checkPolicy(ctx, it, now);
    // dry runs ignore deferrals (quiet hours, gaps) but still respect blocks
    if (!policy.ok && (policy.block || !opts.dryRun)) {
      if (!opts.dryRun) {
        if (policy.block) (it.status = "blocked"), (it.lastError = policy.reason);
        else (it.notBefore = policy.retryAt), (it.lastError = `deferred: ${policy.reason}`);
        it.updatedAt = now.toISOString();
      }
      result = { ok: false, item: { ...it }, policy };
      return;
    }
    const token = crypto.randomBytes(8).toString("hex");
    if (!opts.dryRun) {
      it.status = "sending";
      it.claim = { token, by: opts.by ?? ctx.actor, at: now.toISOString() };
      it.attempts += 1;
      it.updatedAt = now.toISOString();
    }
    result = { ok: true, item: { ...it }, token };
  });
  if (!result.ok && !result.skipped && !opts.dryRun && !result.policy.ok)
    audit(ctx, result.policy.block ? "outbox.block" : "outbox.defer", { brand: cur.brand, ref: id, detail: { reason: result.policy.reason, retryAt: result.policy.retryAt } });
  return result;
}

export interface SendOutcome {
  ok: boolean;
  url?: string;
  externalId?: string;
  screenshot?: string;
  note?: string;
  error?: string;
}

export function finishSend(ctx: Ctx, id: string, token: string, outcome: SendOutcome, now = new Date()): OutboxItem {
  const cur = getOutbox(ctx, id);
  if (cur.status !== "sending" || cur.claim?.token !== token) throw new MktError(`${id} is not claimed with this token (status ${cur.status})`);
  const it = mutate(ctx, cur.brand, id, (it) => {
    it.claim = undefined;
    if (outcome.ok) {
      it.status = "sent";
      it.sentAt = now.toISOString();
      it.lastError = undefined;
      it.result = { url: outcome.url, externalId: outcome.externalId, screenshot: outcome.screenshot, note: outcome.note };
    } else {
      it.status = "failed";
      it.lastError = outcome.error ?? "unknown error";
      it.result = { screenshot: outcome.screenshot, note: outcome.note };
    }
  });
  if (outcome.ok) afterSent(ctx, it, now);
  audit(ctx, outcome.ok ? "outbox.sent" : "outbox.failed", { brand: it.brand, ref: id, detail: { url: outcome.url, error: outcome.error } });
  return it;
}

function afterSent(ctx: Ctx, it: OutboxItem, now: Date): void {
  recordSend(ctx, it, now);
  if (it.kind !== "post" && it.to) {
    logMessages(ctx, it.brand, [
      { brand: it.brand, account: it.account, platform: it.platform, contact: stripUrl(it.to), leadId: it.to.leadId, direction: "out", text: it.body, subject: it.subject, at: now.toISOString(), url: it.result?.url, outboxId: it.id },
    ]);
  }
  if (it.to?.leadId) {
    updateJson<Lead[]>(brandFile(ctx, it.brand, "leads.json"), [], (leads) => {
      const l = leads.find((x) => x.id === it.to!.leadId);
      if (!l) return;
      l.lastContactAt = now.toISOString();
      if (COLD_KINDS.includes(it.kind)) l.touches += 1;
      if (["new", "researched"].includes(l.stage)) l.stage = "contacted";
      l.updatedAt = now.toISOString();
    });
  }
}

const stripUrl = (to: Recipient) => ({ name: to.name, handle: to.handle ?? (to.url && !to.email && !to.phone ? to.url : undefined), email: to.email, phone: to.phone });

/** Agent-driven path: claim an approved item, do it by hand in the browser, then complete it. */
export function claimOutbox(ctx: Ctx, id: string, by: string): BeginResult {
  return beginSend(ctx, id, { by });
}

/**
 * A crash mid-send leaves items in "sending". We never auto-retry those (the message may have gone out):
 * they become failed with a note so a human checks the account first.
 */
export function recoverStuck(ctx: Ctx, olderThanMin = 20, now = new Date()): OutboxItem[] {
  const cutoff = new Date(now.getTime() - olderThanMin * 60_000).toISOString();
  const stuck = listOutbox(ctx, undefined, { status: ["sending"] }).filter((i) => (i.claim?.at ?? i.updatedAt) < cutoff);
  return stuck.map((s) =>
    mutate(ctx, s.brand, s.id, (it) => {
      it.status = "failed";
      it.claim = undefined;
      it.lastError = "interrupted while sending: check the account before retrying (it may have been sent)";
    }),
  );
}

export function recordDryRun(ctx: Ctx, id: string, r: { screenshot?: string; note?: string }): OutboxItem {
  const cur = getOutbox(ctx, id);
  return mutate(ctx, cur.brand, id, (it) => {
    it.dryRun = { at: nowIso(), ...r };
  });
}
