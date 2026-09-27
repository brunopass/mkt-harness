import { z } from "zod";

export const PLATFORMS = ["instagram", "linkedin", "x", "tiktok", "facebook", "threads", "youtube", "whatsapp", "email"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

// ---------------------------------------------------------------- accounts

export const Transport = z.enum(["browser", "smtp", "whatsapp_cloud"]);
export type Transport = z.infer<typeof Transport>;

export const LimitRule = z.object({ perDay: z.number().int().nonnegative(), minGapSec: z.number().int().nonnegative() });
export type LimitRule = z.infer<typeof LimitRule>;

export const Account = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase letters, digits, - and _"),
  platform: Platform,
  handle: z.string(),
  label: z.string().optional(),
  transport: Transport.default("browser"),
  active: z.boolean().default(true),
  /** read this account's inbox during `mkt inbox sync` / the daemon */
  inbox: z.boolean().default(false),
  /** per-kind overrides of config.limits for this account */
  limits: z.record(z.string(), LimitRule.partial()).optional(),
  /** smtp transport: env var holding smtp(s)://user:pass@host:port, optional IMAP url env for inbox */
  email: z.object({ from: z.string(), smtpUrlEnv: z.string().optional(), imapUrlEnv: z.string().optional() }).optional(),
  /** whatsapp_cloud transport: env var names, never the secrets themselves */
  whatsappCloud: z.object({ phoneNumberIdEnv: z.string(), tokenEnv: z.string(), apiVersion: z.string().default("v23.0") }).optional(),
});
export type Account = z.infer<typeof Account>;
export const AccountsFile = z.object({ accounts: z.array(Account).default([]) });

// ---------------------------------------------------------------- brand

export const BrandConfig = z.object({
  slug: z.string(),
  name: z.string(),
  website: z.string().optional(),
  languages: z.array(z.string()).default(["en"]),
  timezone: z.string().default("UTC"),
  category: z.string().optional(),
  /** legal sender identity, appended to cold email footers */
  sender: z.object({ name: z.string().optional(), address: z.string().optional() }).optional(),
  visual: z
    .object({
      bg: z.string().default("#0f0f10"),
      fg: z.string().default("#f5f5f4"),
      accent: z.string().default("#f97316"),
      muted: z.string().default("#a8a29e"),
      font: z.string().default("Inter"),
      headingFont: z.string().optional(),
      logo: z.string().optional(),
    })
    .default({ bg: "#0f0f10", fg: "#f5f5f4", accent: "#f97316", muted: "#a8a29e", font: "Inter" }),
  pillars: z.array(z.string()).default([]),
  banned: z.array(z.string()).default([]).describe("words/claims never to use"),
});
export type BrandConfig = z.infer<typeof BrandConfig>;

// ---------------------------------------------------------------- content

export const CONTENT_STATUSES = ["idea", "brief", "draft", "review", "approved", "scheduled", "published", "archived"] as const;
export const ContentStatus = z.enum(CONTENT_STATUSES);
export const CONTENT_FORMATS = [
  "reel", "short", "video", "carousel", "image", "post", "thread", "article", "story", "newsletter", "email", "live",
] as const;
export const ContentFormat = z.enum(CONTENT_FORMATS);
export const Funnel = z.enum(["tofu", "mofu", "bofu"]);

export const ContentMeta = z.object({
  id: z.string(),
  brand: z.string(),
  title: z.string(),
  status: ContentStatus.default("idea"),
  format: ContentFormat.default("post"),
  pillar: z.string().optional(),
  persona: z.string().optional(),
  funnel: Funnel.optional(),
  platforms: z.array(Platform).default([]),
  hook: z.string().optional(),
  cta: z.string().optional(),
  leadMagnet: z.string().optional(),
  trend: z.string().optional(),
  language: z.string().optional(),
  score: z.number().optional(),
  scores: z.record(z.string(), z.number()).optional(),
  scheduledFor: z.string().optional(),
  accounts: z.array(z.string()).default([]),
  media: z.array(z.string()).default([]),
  published: z.array(z.object({ account: z.string(), url: z.string().optional(), at: z.string() })).default([]),
  metrics: z.record(z.string(), z.number()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentMeta = z.infer<typeof ContentMeta>;
export type ContentItem = ContentMeta & { body: string; path: string };

// ---------------------------------------------------------------- leads

export const LEAD_STAGES = [
  "new", "researched", "contacted", "replied", "qualified", "meeting", "customer", "lost", "do_not_contact",
] as const;
export const LeadStage = z.enum(LEAD_STAGES);
export type LeadStage = z.infer<typeof LeadStage>;

export const Consent = z.object({
  email: z.enum(["none", "legitimate_interest", "opt_in"]).default("none"),
  whatsapp: z.enum(["none", "opt_in"]).default("none"),
  basis: z.string().optional().describe("how/when consent or legitimate interest was established"),
});

export const Lead = z.object({
  id: z.string(),
  brand: z.string(),
  name: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  handles: z.record(z.string(), z.string()).default({}).describe("platform -> handle or profile URL"),
  location: z.string().optional(),
  language: z.string().optional(),
  persona: z.string().optional(),
  stage: LeadStage.default("new"),
  score: z.number().min(0).max(100).default(0),
  tags: z.array(z.string()).default([]),
  source: z.object({ kind: z.string(), detail: z.string().optional(), url: z.string().optional() }),
  consent: Consent.default({ email: "none", whatsapp: "none" }),
  research: z.string().optional().describe("short personalisation notes: what they post about, recent events"),
  notes: z.array(z.object({ at: z.string(), text: z.string() })).default([]),
  touches: z.number().int().default(0),
  lastContactAt: z.string().optional(),
  lastInboundAt: z.string().optional(),
  nextActionAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Lead = z.infer<typeof Lead>;

// ---------------------------------------------------------------- outbox

export const OUTBOX_KINDS = ["post", "dm", "reply", "comment", "connect", "email"] as const;
export const OutboxKind = z.enum(OUTBOX_KINDS);
export type OutboxKind = z.infer<typeof OutboxKind>;
/** kinds that start a conversation with someone who has not written to us */
export const COLD_KINDS: readonly OutboxKind[] = ["dm", "connect", "email"];

export const OUTBOX_STATUSES = [
  "draft", "pending_approval", "approved", "sending", "sent", "failed", "blocked", "cancelled",
] as const;
export const OutboxStatus = z.enum(OUTBOX_STATUSES);
export type OutboxStatus = z.infer<typeof OutboxStatus>;

export const Recipient = z.object({
  leadId: z.string().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional().describe("profile URL, thread URL or post URL (for comments)"),
});
export type Recipient = z.infer<typeof Recipient>;

export const OutboxItem = z.object({
  id: z.string(),
  brand: z.string(),
  kind: OutboxKind,
  account: z.string(),
  platform: Platform,
  to: Recipient.optional(),
  subject: z.string().optional(),
  body: z.string(),
  media: z.array(z.string()).default([]),
  contentId: z.string().optional(),
  sequence: z.object({ name: z.string(), step: z.number().int() }).optional(),
  rationale: z.string().optional().describe("why this message, shown to the human reviewer"),
  hold: z.string().optional().describe("keep for a human even in autopilot, with the reason (legal, refunds, press, complaints, data requests)"),
  scheduledFor: z.string().optional(),
  notBefore: z.string().optional().describe("set by policy deferrals (quiet hours, rate limits)"),
  status: OutboxStatus,
  approval: z.object({ by: z.string(), at: z.string(), note: z.string().optional() }).optional(),
  claim: z.object({ token: z.string(), by: z.string(), at: z.string() }).optional(),
  attempts: z.number().int().default(0),
  lastError: z.string().optional(),
  result: z
    .object({ url: z.string().optional(), externalId: z.string().optional(), screenshot: z.string().optional(), note: z.string().optional() })
    .optional(),
  dryRun: z.object({ at: z.string(), screenshot: z.string().optional(), note: z.string().optional() }).optional(),
  createdBy: z.string().default("agent"),
  createdAt: z.string(),
  updatedAt: z.string(),
  sentAt: z.string().optional(),
});
export type OutboxItem = z.infer<typeof OutboxItem>;

// ---------------------------------------------------------------- conversations, insights, trends

export const Message = z.object({
  id: z.string(),
  brand: z.string(),
  account: z.string(),
  platform: Platform,
  threadKey: z.string(),
  contact: z.object({ name: z.string().optional(), handle: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }),
  leadId: z.string().optional(),
  direction: z.enum(["in", "out"]),
  text: z.string(),
  subject: z.string().optional(),
  at: z.string(),
  url: z.string().optional(),
  externalId: z.string().optional(),
  outboxId: z.string().optional(),
  flags: z.array(z.string()).default([]).describe("e.g. opt_out, not_interested"),
});
export type Message = z.infer<typeof Message>;

export const INSIGHT_KINDS = [
  "pain", "desire", "objection", "question", "language", "trigger", "competitor", "praise", "feature_request", "fact",
] as const;
export const Insight = z.object({
  id: z.string(),
  brand: z.string(),
  persona: z.string().optional(),
  kind: z.enum(INSIGHT_KINDS),
  text: z.string().describe("the insight in our words"),
  quote: z.string().optional().describe("verbatim customer language, the most valuable part"),
  source: z.string().describe("e.g. reddit, review:g2, dm:instagram, call, comment"),
  url: z.string().optional(),
  weight: z.number().int().min(1).max(5).default(3),
  at: z.string(),
});
export type Insight = z.infer<typeof Insight>;

export const TrendObservation = z.object({
  id: z.string(),
  brand: z.string(),
  topic: z.string(),
  source: z.string().describe("google_trends_BR, tiktok_creative_center, youtube_search, reddit, x_explore, ..."),
  metric: z.string().describe("views, posts, search_interest, approx_traffic, rank, mentions, ..."),
  value: z.number(),
  at: z.string(),
  url: z.string().optional(),
  note: z.string().optional(),
});
export type TrendObservation = z.infer<typeof TrendObservation>;

export const SuppressionEntry = z.object({
  id: z.string().describe("normalised identifier: email, +phone, or platform:handle"),
  reason: z.string(),
  source: z.string().optional(),
  at: z.string(),
});
export type SuppressionEntry = z.infer<typeof SuppressionEntry>;

export const AuditEvent = z.object({
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  brand: z.string().optional(),
  ref: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
