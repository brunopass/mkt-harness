import path from "node:path";
import type { Ctx } from "./config.js";
import type { Recipient, SuppressionEntry } from "./schemas.js";
import { audit, nowIso, readJson, updateJson } from "./store.js";

// ---------------------------------------------------------------- normalisation

export function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/** Digits with a leading +. Numbers without a country code are kept as-is (digits only). */
export function normPhone(p: string): string {
  const t = p.trim();
  const digits = t.replace(/\D/g, "");
  return (t.startsWith("+") || t.startsWith("00") ? "+" : "") + (t.startsWith("00") ? digits.slice(2) : digits);
}

/** "@Jane", "https://instagram.com/jane/", "jane" -> "jane" */
export function normHandle(h: string): string {
  let s = h.trim();
  const m = s.match(/^https?:\/\/[^/]+\/(?:in\/|company\/)?@?([^/?#]+)/i);
  if (m) s = m[1];
  return s.replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

/** Every identifier a recipient can be suppressed under. */
export function recipientIds(platform: string, to: Recipient | undefined): string[] {
  if (!to) return [];
  const ids: string[] = [];
  if (to.email) ids.push(normEmail(to.email));
  if (to.phone) ids.push(normPhone(to.phone));
  if (to.handle) ids.push(`${platform}:${normHandle(to.handle)}`);
  if (to.url && platform !== "email" && platform !== "whatsapp" && /^https?:/.test(to.url)) ids.push(`${platform}:${normHandle(to.url)}`);
  return ids;
}

export function normIdentifier(raw: string): string {
  const s = raw.trim();
  if (s.includes("@") && !s.startsWith("@") && !s.includes(":")) return normEmail(s);
  if (/^[+0-9][0-9 ()\-.]{6,}$/.test(s)) return normPhone(s);
  const m = s.match(/^([a-z]+):(.+)$/i);
  if (m) return `${m[1].toLowerCase()}:${normHandle(m[2])}`;
  throw new Error(`identifier "${raw}" must be an email, a phone number, or platform:handle (e.g. instagram:janedoe)`);
}

// ---------------------------------------------------------------- suppression

const suppressionFile = (ctx: Ctx) => path.join(ctx.ws, "suppression.json");

export function suppressionList(ctx: Ctx): SuppressionEntry[] {
  return readJson<SuppressionEntry[]>(suppressionFile(ctx), []);
}

export function isSuppressed(ctx: Ctx, ids: string[]): SuppressionEntry | undefined {
  if (!ids.length) return undefined;
  const set = new Set(ids);
  return suppressionList(ctx).find((e) => set.has(e.id));
}

export function suppress(ctx: Ctx, identifiers: string[], reason: string, source?: string): SuppressionEntry[] {
  const ids = identifiers.map(normIdentifier);
  const added: SuppressionEntry[] = [];
  updateJson<SuppressionEntry[]>(suppressionFile(ctx), [], (list) => {
    for (const id of ids) {
      if (list.some((e) => e.id === id)) continue;
      const e = { id, reason, source, at: nowIso() };
      list.push(e);
      added.push(e);
    }
  });
  if (added.length) audit(ctx, "suppress", { detail: { ids: added.map((a) => a.id), reason, source } });
  return added;
}

// ---------------------------------------------------------------- opt-out detection

/** Strong opt-outs: suppress forever. Multilingual (en, pt, es, it, fr, de). */
const OPT_OUT = [
  /\bunsubscribe\b/i, /\bopt[- ]?out\b/i, /\bremove me\b/i, /\b(do not|don't|dont) (contact|message|email|text|write)\b/i,
  /\bstop (messaging|emailing|texting|contacting|writing)\b/i, /\btake me off\b/i,
  /\bdescadastr/i, /\bme (tire|tira|remova|remove) d[ae]/i, /\bn[aã]o (me )?(mande|envie|escreva|contate)\b/i, /\bpar[ea] de me\b/i,
  /\bdar(me)? de baja\b/i, /\bno me (escribas|escriban|contactes|contacten|env[ií]es)\b/i, /\bdesuscrib/i,
  /\bdisiscriv/i, /\bnon (scrivermi|contattarmi)\b/i, /\bcancellami\b/i,
  /\bd[ée]sabonn/i, /\bd[ée]sinscri/i, /\bne (plus )?me (contactez|[ée]crivez)\b/i,
  /\babmelden\b/i, /\bkeine (weiteren )?nachrichten\b/i,
];
/** Whole-message keywords: only when the message is essentially just the word. */
const OPT_OUT_BARE = /^\s*(stop|stopp|unsubscribe|parar|pare|sair|remover|baja|cancelar|basta|arr[eê]te)\s*[.!]*\s*$/i;
/** Soft: close the lead and stop sequences, do not suppress. */
const NOT_INTERESTED = [
  /\bnot interested\b/i, /\bno thanks\b/i, /\bn[aã]o (tenho|estou) interess/i, /\bsem interesse\b/i, /\bno (me )?interesa\b/i,
  /\bnon (mi )?interessa\b/i, /\bpas int[ée]ress[ée]\b/i, /\bkein interesse\b/i,
];

export type OptOutSignal = "opt_out" | "not_interested" | null;

export function detectOptOut(text: string): OptOutSignal {
  const t = text.slice(0, 2000);
  if (OPT_OUT_BARE.test(t) || OPT_OUT.some((r) => r.test(t))) return "opt_out";
  if (NOT_INTERESTED.some((r) => r.test(t))) return "not_interested";
  return null;
}

/** For display and tests. */
export function suppressionIdsFor(platform: string, contact: { email?: string; phone?: string; handle?: string }): string[] {
  return recipientIds(platform, contact);
}

