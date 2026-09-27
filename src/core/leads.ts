import type { Ctx } from "./config.js";
import { normEmail, normHandle, normPhone } from "./identity.js";
import { Lead, type LeadStage } from "./schemas.js";
import { assertBrand, audit, brandFile, MktError, newId, nowIso, readJson, updateJson } from "./store.js";

const leadsFile = (ctx: Ctx, brand: string) => brandFile(ctx, brand, "leads.json");

export function listLeads(
  ctx: Ctx,
  brand: string,
  f: { stage?: string[]; tag?: string; persona?: string; minScore?: number; dueBefore?: string; sourceKind?: string; createdAfter?: string; q?: string; limit?: number } = {},
): Lead[] {
  assertBrand(ctx, brand);
  let leads = readJson<Lead[]>(leadsFile(ctx, brand), []);
  if (f.stage?.length) leads = leads.filter((l) => f.stage!.includes(l.stage));
  if (f.tag) leads = leads.filter((l) => l.tags.includes(f.tag!));
  if (f.persona) leads = leads.filter((l) => l.persona === f.persona);
  if (f.minScore != null) leads = leads.filter((l) => l.score >= f.minScore!);
  if (f.dueBefore) leads = leads.filter((l) => l.nextActionAt && l.nextActionAt <= f.dueBefore!);
  if (f.sourceKind) leads = leads.filter((l) => l.source.kind === f.sourceKind);
  if (f.createdAfter) leads = leads.filter((l) => l.createdAt >= f.createdAfter!);
  if (f.q) {
    const q = f.q.toLowerCase();
    leads = leads.filter((l) => JSON.stringify([l.name, l.company, l.role, l.email, l.handles, l.tags]).toLowerCase().includes(q));
  }
  leads.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  return f.limit ? leads.slice(0, f.limit) : leads;
}

export function getLead(ctx: Ctx, brand: string, id: string): Lead {
  const l = readJson<Lead[]>(leadsFile(ctx, brand), []).find((x) => x.id === id);
  if (!l) throw new MktError(`lead "${id}" not found in ${brand}`);
  return l;
}

/** Keys that identify the same person across sources. */
export function leadKeys(l: Pick<Lead, "email" | "phone" | "handles">): string[] {
  const keys: string[] = [];
  if (l.email) keys.push(`e:${normEmail(l.email)}`);
  if (l.phone) keys.push(`p:${normPhone(l.phone)}`);
  for (const [platform, h] of Object.entries(l.handles ?? {})) if (h) keys.push(`h:${platform}:${normHandle(h)}`);
  return keys;
}

export function findLeadBy(ctx: Ctx, brand: string, c: { email?: string; phone?: string; platform?: string; handle?: string }): Lead | undefined {
  const keys = leadKeys({ email: c.email, phone: c.phone, handles: c.platform && c.handle ? { [c.platform]: c.handle } : {} });
  if (!keys.length) return undefined;
  return readJson<Lead[]>(leadsFile(ctx, brand), []).find((l) => leadKeys(l).some((k) => keys.includes(k)));
}

export type LeadInput = Partial<Omit<Lead, "brand" | "createdAt" | "updatedAt" | "notes">> & { note?: string; source?: Lead["source"] };

/**
 * Insert or merge. Matches on id, email, phone or any platform handle. Merging never downgrades a stage,
 * never lowers consent, and never revives a do_not_contact lead.
 */
export function upsertLead(ctx: Ctx, brand: string, input: LeadInput): { lead: Lead; created: boolean } {
  assertBrand(ctx, brand);
  let created = false;
  let result!: Lead;
  updateJson<Lead[]>(leadsFile(ctx, brand), [], (leads) => {
    const keys = leadKeys({ email: input.email, phone: input.phone, handles: input.handles ?? {} });
    const idx = leads.findIndex((l) => (input.id && l.id === input.id) || leadKeys(l).some((k) => keys.includes(k)));
    const at = nowIso();
    const { note, ...fields } = input;
    if (idx === -1) {
      if (!fields.source) throw new MktError("new leads need a source {kind, detail?, url?}: where did we find them?");
      created = true;
      result = Lead.parse({ ...fields, id: input.id ?? newId("ld"), brand, createdAt: at, updatedAt: at, notes: note ? [{ at, text: note }] : [] });
      leads.push(result);
    } else {
      const cur = leads[idx];
      const merged: Lead = {
        ...cur,
        ...stripUndefined(fields),
        id: cur.id,
        brand,
        handles: { ...cur.handles, ...(fields.handles ?? {}) },
        tags: [...new Set([...cur.tags, ...(fields.tags ?? [])])],
        stage: mergeStage(cur.stage, fields.stage),
        consent: mergeConsent(cur.consent, fields.consent),
        source: cur.source,
        notes: note ? [...cur.notes, { at, text: note }] : cur.notes,
        createdAt: cur.createdAt,
        updatedAt: at,
      };
      result = Lead.parse(merged);
      leads[idx] = result;
    }
  });
  audit(ctx, created ? "lead.create" : "lead.merge", { brand, ref: result.id, detail: { stage: result.stage } });
  return { lead: result, created };
}

/** Explicit update: may set any stage (humans and agents move leads backwards on purpose). */
export function updateLead(ctx: Ctx, brand: string, id: string, patch: Partial<Omit<Lead, "id" | "brand" | "createdAt">> & { note?: string }): Lead {
  assertBrand(ctx, brand);
  let result!: Lead;
  updateJson<Lead[]>(leadsFile(ctx, brand), [], (leads) => {
    const idx = leads.findIndex((l) => l.id === id);
    if (idx === -1) throw new MktError(`lead "${id}" not found in ${brand}`);
    const cur = leads[idx];
    const { note, ...fields } = patch;
    const at = nowIso();
    if (cur.stage === "do_not_contact" && fields.stage && fields.stage !== "do_not_contact" && ctx.actor !== "human:cli")
      throw new MktError(`lead ${id} is do_not_contact; only a human can change that (mkt leads set-stage)`);
    result = Lead.parse({
      ...cur,
      ...stripUndefined(fields),
      handles: { ...cur.handles, ...(fields.handles ?? {}) },
      notes: note ? [...cur.notes, { at, text: note }] : cur.notes,
      updatedAt: at,
    });
    leads[idx] = result;
  });
  audit(ctx, "lead.update", { brand, ref: id, detail: { fields: Object.keys(patch) } });
  return result;
}

const STAGE_RANK: Record<LeadStage, number> = {
  new: 0, researched: 1, contacted: 2, replied: 3, qualified: 4, meeting: 5, customer: 6, lost: 7, do_not_contact: 8,
};

function mergeStage(cur: LeadStage, next?: LeadStage): LeadStage {
  if (!next || cur === "do_not_contact") return cur;
  return STAGE_RANK[next] > STAGE_RANK[cur] ? next : cur;
}

function mergeConsent(cur: Lead["consent"], next?: Partial<Lead["consent"]>): Lead["consent"] {
  if (!next) return cur;
  const emailRank = { none: 0, legitimate_interest: 1, opt_in: 2 } as const;
  const waRank = { none: 0, opt_in: 1 } as const;
  return {
    email: next.email && emailRank[next.email] > emailRank[cur.email] ? next.email : cur.email,
    whatsapp: next.whatsapp && waRank[next.whatsapp] > waRank[cur.whatsapp] ? next.whatsapp : cur.whatsapp,
    basis: next.basis ?? cur.basis,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------- CSV import

/** Minimal RFC 4180 parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/**
 * Columns: name, company, role, email, phone, persona, tags (| separated), notes, consent_email, consent_whatsapp,
 * and one column per platform handle (instagram, linkedin, x, tiktok, ...).
 */
export function importLeadsCsv(ctx: Ctx, brand: string, text: string, source: string): { created: number; merged: number; skipped: number } {
  const platforms = ["instagram", "linkedin", "x", "tiktok", "facebook", "threads", "youtube", "whatsapp"];
  let created = 0, merged = 0, skipped = 0;
  for (const r of parseCsv(text)) {
    const handles = Object.fromEntries(platforms.filter((p) => r[p]).map((p) => [p, r[p]]));
    if (!r.email && !r.phone && !Object.keys(handles).length) {
      skipped++;
      continue;
    }
    const res = upsertLead(ctx, brand, {
      name: r.name || undefined,
      company: r.company || undefined,
      role: r.role || undefined,
      email: r.email || undefined,
      phone: r.phone || undefined,
      persona: r.persona || undefined,
      handles,
      tags: r.tags ? r.tags.split("|").map((t) => t.trim()).filter(Boolean) : [],
      consent: {
        email: (["none", "legitimate_interest", "opt_in"].includes(r.consent_email) ? r.consent_email : "none") as any,
        whatsapp: (r.consent_whatsapp === "opt_in" ? "opt_in" : "none") as any,
        basis: r.consent_basis || undefined,
      },
      source: { kind: "import", detail: source },
      note: r.notes || undefined,
    });
    res.created ? created++ : merged++;
  }
  return { created, merged, skipped };
}
