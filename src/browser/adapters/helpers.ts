import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright-core";
import type { Ctx } from "../../core/config.js";
import { brandDir } from "../../core/store.js";
import { typeInto } from "../snapshot.js";
import { AdapterError, type AdapterEnv, type SendResult } from "./types.js";

/**
 * A candidate is a CSS/Playwright selector string or a function building a locator (prefer getByRole / getByLabel:
 * they survive class-name churn). Platforms change their UI often; list several candidates, most specific first.
 */
export type Candidate = string | ((p: Page) => Locator);

const build = (page: Page, c: Candidate) => (typeof c === "string" ? page.locator(c) : c(page));

/** First candidate with a visible match, polling until timeout. */
export async function firstVisible(page: Page, step: string, candidates: Candidate[], timeoutMs = 15_000): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    for (const c of candidates) {
      const loc = build(page, c).first();
      try {
        if (await loc.isVisible()) return loc;
      } catch {}
    }
    if (Date.now() > deadline) break;
    await page.waitForTimeout(300);
  }
  throw new AdapterError(step, `none of ${candidates.length} locators became visible (${candidates.map(describe).join(" | ")})`);
}

/** Like firstVisible but returns undefined instead of throwing. */
export async function maybeVisible(page: Page, candidates: Candidate[], timeoutMs = 3_000): Promise<Locator | undefined> {
  try {
    return await firstVisible(page, "probe", candidates, timeoutMs);
  } catch {
    return undefined;
  }
}

/**
 * Poll until the page looks logged in or logged out; never throws. Error pages (a 403 to headless, offline) and URLs
 * matching `outUrl` count as logged out; the URL is re-checked every round because login walls redirect late.
 */
export async function loginState(
  page: Page,
  o: { loggedIn: Candidate[]; loggedOut: Candidate[]; outUrl?: RegExp; timeoutMs?: number; alsoIn?: (p: Page) => Promise<boolean> },
): Promise<boolean> {
  try {
    if (page.url().startsWith("chrome-error://") || (await page.locator("#main-frame-error").count()) > 0) return false;
    const deadline = Date.now() + (o.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      if (o.outUrl?.test(page.url())) return false;
      if (await maybeVisible(page, o.loggedOut, 0)) return false;
      if (await maybeVisible(page, o.loggedIn, 0)) return true;
      if (o.alsoIn && (await o.alsoIn(page))) return true;
      await page.waitForTimeout(400);
    }
  } catch {}
  return false;
}

export async function clickFirst(page: Page, step: string, candidates: Candidate[], timeoutMs = 15_000): Promise<void> {
  const loc = await firstVisible(page, step, candidates, timeoutMs);
  try {
    await loc.click({ timeout: 10_000 });
  } catch (e: any) {
    throw new AdapterError(step, `click failed: ${e.message.split("\n")[0]}`);
  }
}

/** Waits until the element is enabled (Post buttons are disabled until text/media are accepted). */
export async function clickWhenEnabled(page: Page, step: string, candidates: Candidate[], timeoutMs = 30_000): Promise<void> {
  const loc = await firstVisible(page, step, candidates, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const disabled = await loc
      .evaluate((el) => (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true")
      .catch(() => false);
    if (!disabled) break;
    await page.waitForTimeout(400);
  }
  try {
    await loc.click({ timeout: 10_000 });
  } catch (e: any) {
    throw new AdapterError(step, `click failed: ${e.message.split("\n")[0]}`);
  }
}

export async function typeText(page: Page, step: string, candidates: Candidate[], text: string, opts: { newline?: "shift-enter" | "enter"; clear?: boolean } = {}): Promise<Locator> {
  const loc = await firstVisible(page, step, candidates);
  try {
    await typeInto(page, loc, text, opts);
  } catch (e: any) {
    throw new AdapterError(step, `typing failed: ${e.message.split("\n")[0]}`);
  }
  return loc;
}

/**
 * Attach files either through an <input type=file> (hidden ones included) or by clicking a trigger that opens the
 * OS file chooser. Pass the input selector first; the trigger is the fallback.
 */
export async function attachFiles(page: Page, step: string, files: string[], opts: { input?: string; trigger?: Candidate[] }): Promise<void> {
  if (!files.length) return;
  for (const f of files) if (!fs.existsSync(f)) throw new AdapterError(step, `media file not found: ${f}`);
  if (opts.input) {
    const input = page.locator(opts.input).first();
    if ((await input.count()) > 0) {
      await input.setInputFiles(files);
      return;
    }
  }
  if (opts.trigger) {
    const trigger = await firstVisible(page, step, opts.trigger);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15_000 }), trigger.click()]);
    await chooser.setFiles(files);
    return;
  }
  throw new AdapterError(step, "no file input or upload trigger found");
}

/** The single place adapters stop in dry-run mode. */
export async function dryRunStop(env: AdapterEnv, what: string): Promise<SendResult> {
  const screenshot = await env.shot(`dry-run-${what}`);
  return { note: `dry run: ${what} prepared, not sent`, screenshot };
}

export function resolveMedia(ctx: Ctx, brand: string, media: string[]): string[] {
  return media.map((m) => (path.isAbsolute(m) ? m : fs.existsSync(path.join(brandDir(ctx, brand), m)) ? path.join(brandDir(ctx, brand), m) : path.resolve(ctx.ws, m)));
}

export function describe(c: Candidate): string {
  return typeof c === "string" ? c : c.toString().replace(/\s+/g, " ").replace(/^\(?\w*\)?\s*=>\s*/, "").slice(0, 80);
}

/** "https://instagram.com/jane" / "@jane" / "jane" -> "jane" */
export function bareHandle(h: string): string {
  const m = h.trim().match(/^https?:\/\/[^/]+\/(?:in\/)?@?([^/?#]+)/i);
  return (m ? m[1] : h.trim()).replace(/^@/, "").replace(/\/+$/, "");
}

export const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
