/** Wall-clock parts of `d` in an IANA timezone. */
export function zoned(d: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { year: +get("year"), month: +get("month"), day: +get("day"), hour: +get("hour") % 24, minute: +get("minute"), weekday };
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Quiet window may wrap midnight ("21:00" -> "08:30"). */
export function inQuietHours(d: Date, timeZone: string, q: { start: string; end: string } | null): boolean {
  if (!q) return false;
  const z = zoned(d, timeZone);
  const t = z.hour * 60 + z.minute;
  const s = hm(q.start), e = hm(q.end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

/** First moment at or after `d` outside quiet hours (5-minute resolution). */
export function quietHoursEnd(d: Date, timeZone: string, q: { start: string; end: string } | null): Date {
  let t = new Date(d);
  for (let i = 0; i < 24 * 12 + 1 && inQuietHours(t, timeZone, q); i++) t = new Date(t.getTime() + 5 * 60_000);
  return t;
}

// ---------------------------------------------------------------- cron

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? parseInt(stepS, 10) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`bad cron step "${part}"`);
    let lo: number, hi: number;
    if (range === "*") (lo = min), (hi = max);
    else if (range.includes("-")) [lo, hi] = range.split("-").map((x) => parseInt(x, 10));
    else (lo = parseInt(range, 10)), (hi = stepS ? max : lo);
    if (![lo, hi].every(Number.isFinite) || lo < min || hi > max || lo > hi) throw new Error(`bad cron field "${part}" (range ${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

export function parseCron(expr: string): Cron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron "${expr}" needs 5 fields: minute hour day-of-month month day-of-week`);
  const dow = field(f[4], 0, 7);
  if (dow.has(7)) dow.add(0);
  return {
    minute: field(f[0], 0, 59), hour: field(f[1], 0, 23), dom: field(f[2], 1, 31), month: field(f[3], 1, 12), dow,
    domStar: f[2] === "*", dowStar: f[4] === "*",
  };
}

/** Standard cron semantics: when both day fields are restricted, either may match. */
export function cronMatches(expr: string | Cron, d: Date, timeZone: string): boolean {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  const z = zoned(d, timeZone);
  if (!c.minute.has(z.minute) || !c.hour.has(z.hour) || !c.month.has(z.month)) return false;
  const domOk = c.dom.has(z.day), dowOk = c.dow.has(z.weekday);
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dowOk;
  if (c.dowStar) return domOk;
  return domOk || dowOk;
}
