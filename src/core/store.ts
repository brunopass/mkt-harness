import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Ctx } from "./config.js";

export class MktError extends Error {}

// ---------------------------------------------------------------- ids & time

export function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

/** `prefix_` + base36 time + random: sortable by creation, short enough to type. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------- paths

export const brandDir = (ctx: Ctx, brand: string) => path.join(ctx.ws, "brands", brand);
export const brandFile = (ctx: Ctx, brand: string, ...rest: string[]) => path.join(brandDir(ctx, brand), ...rest);
export const stateFile = (ctx: Ctx, ...rest: string[]) => path.join(ctx.ws, "state", ...rest);

export function assertBrand(ctx: Ctx, brand: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(brand)) throw new MktError(`invalid brand slug "${brand}"`);
  if (!fs.existsSync(brandFile(ctx, brand, "brand.yaml")))
    throw new MktError(`unknown brand "${brand}" (no ${path.relative(ctx.root, brandFile(ctx, brand, "brand.yaml"))}); run: mkt brand new ${brand}`);
}

// ---------------------------------------------------------------- locking

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Cross-process lock via mkdir (atomic on every local filesystem). Holders are short read-modify-write
 * sections, so a lock older than 30s is a crashed process and gets broken.
 */
export function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 15_000;
  for (let i = 0; ; i++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new MktError(`timed out waiting for lock ${lock}`);
      sleepSync(Math.min(10 * 2 ** Math.min(i, 5), 200));
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- json

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e: any) {
    if (e.code === "ENOENT") return fallback;
    throw new MktError(`cannot read ${file}: ${e.message}`);
  }
}

export function writeFileAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJson(file: string, data: unknown): void {
  writeFileAtomic(file, JSON.stringify(data, null, 2) + "\n");
}

/** Locked read-modify-write. `fn` may mutate the value in place or return a new one. */
export function updateJson<T>(file: string, fallback: T, fn: (value: T) => T | void): T {
  return withLock(file, () => {
    const cur = readJson<T>(file, fallback);
    const next = (fn(cur) ?? cur) as T;
    writeJson(file, next);
    return next;
  });
}

// ---------------------------------------------------------------- jsonl

export function appendJsonl(file: string, ...rows: unknown[]): void {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readJsonl<T>(file: string): T[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn last line from a crash: skip it rather than lose the file
    }
  }
  return out;
}

// ---------------------------------------------------------------- audit

export function audit(ctx: Ctx, action: string, e: { brand?: string; ref?: string; detail?: Record<string, unknown> } = {}): void {
  appendJsonl(path.join(ctx.ws, "audit.jsonl"), { at: nowIso(), actor: ctx.actor, action, ...e });
}

// ---------------------------------------------------------------- misc

export function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  const r = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
