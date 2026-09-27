import type { Frame, Locator, Page } from "playwright-core";

/**
 * Agent-facing page model: every visible interactive element gets a stable `data-mkt-ref` ("e12", or "f2e5" inside
 * frame 2) and one line of role + accessible name + state. The agent acts on refs; refs survive until the element
 * leaves the DOM, so re-snapshot after big page changes.
 */

interface RawItem {
  ref: string;
  role: string;
  name: string;
  value?: string;
  states: string[];
  inView: boolean;
}

/*
 * Runs inside the page. A plain JS string on purpose: tsx/esbuild would inject `__name()` helpers into nested
 * functions, and those do not exist in the page when Playwright serialises the function.
 */
const COLLECT = `(args) => {
  const w = window;
  w.__mktSeq = w.__mktSeq || 0;
  const SEL = [
    "a[href]", "button", "input:not([type=hidden])", "textarea", "select", "summary", "label[for]",
    "[role=button]", "[role=link]", "[role=textbox]", "[role=searchbox]", "[role=combobox]", "[role=menuitem]",
    "[role=menuitemcheckbox]", "[role=option]", "[role=tab]", "[role=checkbox]", "[role=radio]", "[role=switch]",
    "[contenteditable='']", "[contenteditable='true']", "[contenteditable='plaintext-only']", "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = clean(lb.split(/\\s+/).map((id) => (document.getElementById(id) || {}).innerText || "").join(" "));
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      const t = clean(Array.from(el.labels).map((l) => l.innerText).join(" "));
      if (t) return t;
    }
    const txt = clean(el.innerText || el.textContent);
    if (txt) return txt;
    const img = el.querySelector("img[alt], svg[aria-label], [aria-label]");
    const ph = el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || el.getAttribute("data-placeholder");
    return clean((img && (img.getAttribute("alt") || img.getAttribute("aria-label"))) || ph || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "");
  };
  const roleOf = (el) => {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) return "textbox";
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "label") return "label";
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      if (["checkbox", "radio", "file", "range"].includes(t)) return t;
      if (["submit", "button", "reset", "image"].includes(t)) return "button";
      return "textbox";
    }
    return "generic";
  };
  const vw = window.innerWidth, vh = window.innerHeight;
  const items = [];
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    const isFile = el.tagName === "INPUT" && el.type === "file";
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!isFile && (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0")) continue;
    if (!isFile && el.closest("[aria-hidden='true']")) continue;
    let ref = el.getAttribute("data-mkt-ref");
    if (!ref || !ref.startsWith(args.prefix + "e")) {
      ref = args.prefix + "e" + (++w.__mktSeq);
      el.setAttribute("data-mkt-ref", ref);
    }
    const states = [];
    if (el.disabled || el.getAttribute("aria-disabled") === "true") states.push("disabled");
    if (el.checked || el.getAttribute("aria-checked") === "true") states.push("checked");
    if (el.getAttribute("aria-selected") === "true") states.push("selected");
    if (el.getAttribute("aria-expanded") === "true") states.push("expanded");
    if (document.activeElement === el) states.push("focused");
    if (isFile) states.push("file-input");
    let value;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") value = clean(el.value).slice(0, 80);
    else if (el.isContentEditable) value = clean(el.innerText).slice(0, 80);
    const inView = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    items.push({ ref, role: roleOf(el), name: nameOf(el).slice(0, 100), value: value || undefined, states, inView });
  }
  items.sort((a, b) => Number(b.inView) - Number(a.inView));
  return { items: items.slice(0, args.max), title: document.title, url: location.href };
}`;

interface Collected {
  items: RawItem[];
  title: string;
  url: string;
}

export interface SnapshotOptions {
  maxItems?: number;
  /** include the page's visible text (trimmed) under the element list */
  text?: boolean;
  textChars?: number;
}

export async function snapshot(page: Page, opts: SnapshotOptions = {}): Promise<string> {
  const max = opts.maxItems ?? 200;
  const frames = page.frames();
  const lines: string[] = [];
  let header = "";
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (i > 0 && (f.isDetached() || !f.url() || f.url() === "about:blank")) continue;
    let res: Collected;
    try {
      res = (await f.evaluate(`(${COLLECT})(${JSON.stringify({ prefix: i === 0 ? "" : `f${i}`, max })})`)) as Collected;
    } catch {
      continue;
    }
    if (i === 0) header = `page: ${res.title}\nurl: ${res.url.length > 300 ? res.url.slice(0, 300) + "\u2026" : res.url}`;
    else if (res.items.length) lines.push(`-- frame ${i}: ${res.url.slice(0, 100)}`);
    for (const it of res.items) {
      const st = [...it.states, ...(it.inView ? [] : ["offscreen"])];
      lines.push(`[${it.ref}] ${it.role} "${it.name}"${it.value ? ` value="${it.value}"` : ""}${st.length ? ` (${st.join(", ")})` : ""}`);
    }
  }
  let out = `${header}\n\n${lines.join("\n") || "(no interactive elements found)"}`;
  if (opts.text) out += `\n\n--- visible text ---\n${await visibleText(page, opts.textChars ?? 3000)}`;
  return out;
}

export async function visibleText(page: Page, chars = 6000): Promise<string> {
  const t = await page.evaluate(() => {
    const main = document.querySelector("main, [role=main]") as HTMLElement | null;
    return (main ?? document.body).innerText;
  });
  const s = t.replace(/\n{3,}/g, "\n\n").trim();
  return s.length > chars ? `${s.slice(0, chars)}\n…(${s.length - chars} more chars)` : s;
}

export function locatorFor(page: Page, ref: string): Locator {
  const m = ref.match(/^(?:f(\d+))?e(\d+)$/);
  if (!m) throw new Error(`bad ref "${ref}": use the [eN] / [fNeM] refs from browser_snapshot`);
  const frame: Frame = m[1] ? page.frames()[Number(m[1])] : page.mainFrame();
  if (!frame) throw new Error(`frame ${m[1]} is gone; take a new snapshot`);
  return frame.locator(`[data-mkt-ref="${ref}"]`);
}

/** Type into inputs, textareas and rich-text editors. Newlines become Shift+Enter in editors (chat apps send on Enter). */
export async function typeInto(page: Page, loc: Locator, text: string, opts: { clear?: boolean; newline?: "shift-enter" | "enter" } = {}): Promise<void> {
  const editable = await loc.evaluate((el) => (el as HTMLElement).isContentEditable);
  if (!editable) {
    if (opts.clear !== false) await loc.fill(text);
    else await loc.pressSequentially(text);
    return;
  }
  await loc.click();
  if (opts.clear) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press(opts.newline === "enter" ? "Enter" : "Shift+Enter");
  }
}
