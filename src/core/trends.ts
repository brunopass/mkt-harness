import type { Ctx } from "./config.js";
import { TrendObservation } from "./schemas.js";
import { appendJsonl, assertBrand, audit, brandFile, newId, nowIso, readJsonl } from "./store.js";

const obsFile = (ctx: Ctx, brand: string) => brandFile(ctx, brand, "trends", "observations.jsonl");

export type ObservationInput = Omit<TrendObservation, "id" | "brand" | "at"> & { at?: string };

export function observe(ctx: Ctx, brand: string, inputs: ObservationInput[]): TrendObservation[] {
  assertBrand(ctx, brand);
  const rows = inputs.map((i) => TrendObservation.parse({ ...i, topic: i.topic.trim().toLowerCase(), id: newId("tr"), brand, at: i.at ?? nowIso() }));
  appendJsonl(obsFile(ctx, brand), ...rows);
  audit(ctx, "trend.observe", { brand, detail: { count: rows.length } });
  return rows;
}

export function observations(ctx: Ctx, brand: string): TrendObservation[] {
  assertBrand(ctx, brand);
  return readJsonl<TrendObservation>(obsFile(ctx, brand));
}

export type TrendStage = "new_signal" | "surging" | "rising" | "steady" | "peaking" | "fading";

export interface SeriesStat {
  topic: string;
  source: string;
  metric: string;
  n: number;
  first: string;
  last: string;
  lastValue: number;
  maxValue: number;
  /** growth per week from a log-linear fit, e.g. 0.4 = +40%/week */
  weeklyGrowth: number | null;
  r2: number | null;
  forecast7d: number | null;
  stage: TrendStage;
}

export interface TopicStat {
  topic: string;
  sources: number;
  observations: number;
  momentum: number;
  confidence: number;
  stage: TrendStage;
  lastSeen: string;
  series: SeriesStat[];
}

const DAY = 86_400_000;

/** Ordinary least squares on (x, y). */
export function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** Rank-like metrics are better when lower: invert so that "growth" always means "more attention". */
const LOWER_IS_BETTER = /rank|position/i;

export function seriesStat(points: { at: string; value: number }[], meta: { topic: string; source: string; metric: string }): SeriesStat {
  const pts = [...points].sort((a, b) => a.at.localeCompare(b.at));
  const invert = LOWER_IS_BETTER.test(meta.metric);
  const vals = pts.map((p) => (invert ? 1 / Math.max(p.value, 1) : Math.max(p.value, 0)));
  const t0 = Date.parse(pts[0].at);
  const xs = pts.map((p) => (Date.parse(p.at) - t0) / DAY);
  const last = vals[vals.length - 1];
  const max = Math.max(...vals);
  const base: SeriesStat = {
    ...meta, n: pts.length, first: pts[0].at, last: pts[pts.length - 1].at,
    lastValue: pts[pts.length - 1].value, maxValue: invert ? Math.min(...pts.map((p) => p.value)) : max,
    weeklyGrowth: null, r2: null, forecast7d: null, stage: "new_signal",
  };
  const span = xs[xs.length - 1] - xs[0];
  if (pts.length < 2 || span < 0.5) return base;
  const { slope, intercept, r2 } = linreg(xs, vals.map((v) => Math.log1p(v)));
  const weeklyGrowth = Math.expm1(slope * 7);
  let forecast = Math.expm1(intercept + slope * (xs[xs.length - 1] + 7));
  if (invert) forecast = 1 / Math.max(forecast, 1e-9);
  let stage: TrendStage;
  if (pts.length >= 3 && slope > 0 && last < 0.85 * max && vals.indexOf(max) < vals.length - 1) stage = "peaking";
  else if (weeklyGrowth > 0.5) stage = "surging";
  else if (weeklyGrowth > 0.1) stage = "rising";
  else if (weeklyGrowth < -0.1) stage = "fading";
  else stage = "steady";
  return { ...base, weeklyGrowth: round(weeklyGrowth), r2: round(r2), forecast7d: round(forecast), stage };
}

/**
 * Momentum per topic over a window. Each (topic, source, metric) series gets a log-linear fit; the topic's momentum
 * is the confidence-weighted mean weekly growth across its series. Breadth (how many sources see it) raises
 * confidence: a topic rising on three platforms beats a spike on one.
 */
export function momentum(ctx: Ctx, brand: string, opts: { windowDays?: number; now?: Date; topic?: string; limit?: number } = {}): TopicStat[] {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.windowDays ?? 30) * DAY).toISOString();
  const groups = new Map<string, { topic: string; source: string; metric: string; pts: { at: string; value: number }[] }>();
  for (const o of observations(ctx, brand)) {
    if (o.at < since) continue;
    if (opts.topic && o.topic !== opts.topic.toLowerCase()) continue;
    const k = `${o.topic}\u0000${o.source}\u0000${o.metric}`;
    const g = groups.get(k) ?? { topic: o.topic, source: o.source, metric: o.metric, pts: [] };
    g.pts.push({ at: o.at, value: o.value });
    groups.set(k, g);
  }
  const byTopic = new Map<string, SeriesStat[]>();
  for (const g of groups.values()) {
    const s = seriesStat(g.pts, g);
    byTopic.set(g.topic, [...(byTopic.get(g.topic) ?? []), s]);
  }
  const out: TopicStat[] = [];
  for (const [topic, series] of byTopic) {
    const fitted = series.filter((s) => s.weeklyGrowth != null);
    const w = fitted.map((s) => (s.r2 ?? 0) * 0.7 + Math.min(s.n / 10, 1) * 0.3);
    const wsum = w.reduce((a, b) => a + b, 0);
    const mom = fitted.length && wsum > 0 ? fitted.reduce((a, s, i) => a + (s.weeklyGrowth as number) * w[i], 0) / wsum : 0;
    const sources = new Set(series.map((s) => s.source)).size;
    const confidence = Math.min(1, (fitted.length ? wsum / fitted.length : 0) * (0.6 + 0.2 * Math.min(sources, 3)));
    const stages = series.map((s) => s.stage);
    const stage: TrendStage = !fitted.length
      ? "new_signal"
      : stages.includes("peaking") && mom < 0.5
        ? "peaking"
        : mom > 0.5 ? "surging" : mom > 0.1 ? "rising" : mom < -0.1 ? "fading" : "steady";
    out.push({
      topic, sources, observations: series.reduce((a, s) => a + s.n, 0), momentum: round(mom), confidence: round(confidence), stage,
      lastSeen: series.map((s) => s.last).sort().at(-1)!, series,
    });
  }
  out.sort((a, b) => b.momentum * (0.5 + b.confidence) - a.momentum * (0.5 + a.confidence));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- feeds

export interface FeedItem {
  title: string;
  link?: string;
  published?: string;
  summary?: string;
  traffic?: number;
  news?: { title: string; url?: string; source?: string }[];
}

export function feedUrl(spec: string): string {
  const m = spec.match(/^google-trends:([A-Za-z-]{2,5})$/);
  if (m) return `https://trends.google.com/trending/rss?geo=${m[1].toUpperCase()}`;
  if (/^https?:\/\//.test(spec)) return spec;
  throw new Error(`feed must be an http(s) URL or google-trends:<GEO> (e.g. google-trends:BR)`);
}

const decode = (s: string) =>
  s
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1].trim()) : undefined;
}

/** "5000+" -> 5000, "20K+" -> 20000, "1M+" -> 1000000, "2,000+" -> 2000 */
export function parseTraffic(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    const atomLink = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    const news = (b.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/gi) ?? []).map((n) => ({
      title: tag(n, "ht:news_item_title") ?? "",
      url: tag(n, "ht:news_item_url"),
      source: tag(n, "ht:news_item_source"),
    }));
    return {
      title: tag(b, "title") ?? "",
      link: tag(b, "link") || atomLink,
      published: tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated"),
      summary: tag(b, "description") ?? tag(b, "summary"),
      traffic: parseTraffic(tag(b, "ht:approx_traffic")),
      news: news.length ? news : undefined,
    };
  });
}

export async function fetchFeed(spec: string, limit = 30): Promise<FeedItem[]> {
  const url = feedUrl(spec);
  const res = await fetch(url, { headers: { "user-agent": "mkt-harness/0.1 (+rss reader)" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseFeed(await res.text()).slice(0, limit);
}

/** Google Trends feeds carry traffic numbers: record them as observations so momentum can be computed over time. */
export async function fetchFeedAndObserve(ctx: Ctx, brand: string, spec: string, limit = 30): Promise<{ items: FeedItem[]; observed: number }> {
  const items = await fetchFeed(spec, limit);
  const geo = spec.match(/^google-trends:(\w+)/)?.[1]?.toUpperCase();
  const obs = items
    .filter((i) => i.title && i.traffic != null)
    .map((i) => ({ topic: i.title, source: geo ? `google_trends_${geo}` : new URL(feedUrl(spec)).hostname, metric: "approx_traffic", value: i.traffic!, url: i.news?.[0]?.url ?? i.link }));
  if (obs.length) observe(ctx, brand, obs);
  return { items, observed: obs.length };
}
