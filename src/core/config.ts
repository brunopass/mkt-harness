import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";
import { LimitRule, OUTBOX_KINDS } from "./schemas.js";

/** Harness root: the directory holding package.json, AGENTS.md, skills/. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const Routine = z.object({
  name: z.string(),
  cron: z.string().describe("5 fields: minute hour day-of-month month day-of-week, in config.timezone"),
  engine: z.enum(["claude", "codex"]).optional(),
  brand: z.string().optional(),
  prompt: z.string(),
  enabled: z.boolean().default(true),
  /** let this routine click/type in the browser (e.g. filters on TikTok Creative Center); sending tools stay off */
  browserActions: z.boolean().default(false),
});
export type Routine = z.infer<typeof Routine>;

const approvalDefaults = Object.fromEntries(OUTBOX_KINDS.map((k) => [k, true])) as Record<(typeof OUTBOX_KINDS)[number], boolean>;

export const Config = z.object({
  workspace: z.string().default("./workspace"),
  timezone: z.string().default("UTC"),
  engine: z.enum(["claude", "codex"]).default("claude"),
  /** where `mkt open` and the setup open the agent by default (remembered from the last choice) */
  open: z.enum(["claude", "claude-desktop", "codex", "codex-desktop"]).optional(),
  /**
   * review: a human approves everything that reaches a person (mkt review). autopilot: the harness approves the kinds in
   * autopilot.kinds when they're drafted and agents decide without asking; policy checks and holds still apply.
   */
  mode: z.enum(["review", "autopilot"]).default("review"),
  autopilot: z
    .object({ kinds: z.array(z.enum(OUTBOX_KINDS)).default([...OUTBOX_KINDS]) })
    .default({ kinds: [...OUTBOX_KINDS] }),
  approval: z
    .object({
      required: z.record(z.string(), z.boolean()).default(approvalDefaults),
      /** let the MCP tool outbox_approve work; off = only a human (mkt review / approve) can approve */
      allowAgentApproval: z.boolean().default(false),
    })
    .default({ required: approvalDefaults, allowAgentApproval: false }),
  /** cold outreach (dm, connect, email) waits outside these hours, in the brand's timezone */
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable().default({ start: "21:00", end: "08:30" }),
  /** limits[platform][kind] or limits.default[kind] or limits.default["*"] */
  limits: z.record(z.string(), z.record(z.string(), LimitRule)).default({}),
  outreach: z
    .object({
      maxTouchesPerLead: z.number().int().default(4),
      minHoursBetweenTouches: z.number().default(48),
      emailFooter: z.string().default("If you'd rather not hear from us, reply \"stop\" and we won't write again."),
    })
    .default({ maxTouchesPerLead: 4, minHoursBetweenTouches: 48, emailFooter: "If you'd rather not hear from us, reply \"stop\" and we won't write again." }),
  browser: z
    .object({
      executablePath: z.string().nullable().default(null),
      headless: z.boolean().default(false),
      basePort: z.number().int().default(9320),
      windowSize: z.string().default("1280,900"),
      /** extra wait after navigation, ms: gives heavy SPAs time to settle */
      settleMs: z.number().int().default(1200),
    })
    .default({ executablePath: null, headless: false, basePort: 9320, windowSize: "1280,900", settleMs: 1200 }),
  inbox: z.object({ syncEveryMin: z.number().int().default(15) }).default({ syncEveryMin: 15 }),
  runner: z
    .object({
      claude: z
        .object({ bin: z.string().default("claude"), model: z.string().optional(), maxBudgetUsd: z.number().optional(), extraArgs: z.array(z.string()).default([]) })
        .default({ bin: "claude", extraArgs: [] }),
      codex: z
        .object({ bin: z.string().default("codex"), model: z.string().optional(), extraArgs: z.array(z.string()).default([]) })
        .default({ bin: "codex", extraArgs: [] }),
      timeoutMin: z.number().default(45),
    })
    .default({ claude: { bin: "claude", extraArgs: [] }, codex: { bin: "codex", extraArgs: [] }, timeoutMin: 45 }),
  routines: z.array(Routine).default([]),
});
export type Config = z.infer<typeof Config>;

/** Conservative per-account daily limits. They keep brand accounts inside normal human usage. */
export const DEFAULT_LIMITS: Record<string, Record<string, LimitRule>> = {
  default: { "*": { perDay: 20, minGapSec: 120 }, post: { perDay: 3, minGapSec: 3600 }, reply: { perDay: 150, minGapSec: 15 } },
  linkedin: { dm: { perDay: 25, minGapSec: 180 }, connect: { perDay: 15, minGapSec: 240 }, comment: { perDay: 30, minGapSec: 120 } },
  instagram: { dm: { perDay: 20, minGapSec: 240 }, comment: { perDay: 30, minGapSec: 120 } },
  x: { dm: { perDay: 20, minGapSec: 180 }, post: { perDay: 8, minGapSec: 1200 }, comment: { perDay: 40, minGapSec: 90 } },
  tiktok: { dm: { perDay: 15, minGapSec: 300 }, post: { perDay: 3, minGapSec: 3600 } },
  facebook: { dm: { perDay: 20, minGapSec: 180 } },
  threads: { post: { perDay: 6, minGapSec: 1800 } },
  whatsapp: { dm: { perDay: 30, minGapSec: 120 }, reply: { perDay: 300, minGapSec: 5 } },
  email: { email: { perDay: 40, minGapSec: 90 }, reply: { perDay: 200, minGapSec: 10 } },
};

export interface Ctx {
  root: string;
  ws: string;
  config: Config;
  /** who is acting: "human:cli", "agent:mcp", "daemon", ... recorded in the audit log */
  actor: string;
}

export function loadConfig(root = ROOT): Config {
  const file = process.env.MKT_CONFIG ?? path.join(root, "mkt.config.yaml");
  const raw = fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, "utf8")) ?? {}) : {};
  return Config.parse(raw);
}

export function loadCtx(opts: { root?: string; ws?: string; actor?: string; config?: Config } = {}): Ctx {
  const root = opts.root ?? ROOT;
  const config = opts.config ?? loadConfig(root);
  const ws = path.resolve(root, opts.ws ?? process.env.MKT_WORKSPACE ?? config.workspace);
  return { root, ws, config, actor: opts.actor ?? "human:cli" };
}

export function limitFor(ctx: Ctx, platform: string, kind: string, override?: Record<string, Partial<LimitRule>>): LimitRule {
  const L = ctx.config.limits;
  const base =
    L[platform]?.[kind] ?? DEFAULT_LIMITS[platform]?.[kind] ?? L.default?.[kind] ?? DEFAULT_LIMITS.default[kind] ??
    L.default?.["*"] ?? DEFAULT_LIMITS.default["*"];
  return { ...base, ...(override?.[kind] ?? {}) };
}

export function autopilotFor(ctx: Ctx, kind: string): boolean {
  return ctx.config.mode === "autopilot" && (ctx.config.autopilot.kinds as string[]).includes(kind);
}

export function approvalRequired(ctx: Ctx, kind: string): boolean {
  if (autopilotFor(ctx, kind)) return false;
  return ctx.config.approval.required[kind] ?? true;
}

/** Who approves an item that needs no human: "autopilot" (undone when autopilot is switched off) or "policy:auto". */
export function autoApprover(ctx: Ctx, kind: string): "autopilot" | "policy:auto" {
  return autopilotFor(ctx, kind) ? "autopilot" : "policy:auto";
}

/** Approvals that came from a person (the CLI), as opposed to policy, autopilot or an agent. */
export const isHumanApproval = (by?: string) => !!by && by.startsWith("human");
