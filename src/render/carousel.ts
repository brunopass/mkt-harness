import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "../browser/chrome.js";
import { getBrand } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { getContent, section, updateContent } from "../core/content.js";
import type { BrandConfig } from "../core/schemas.js";
import { brandDir, MktError } from "../core/store.js";

export interface Slide {
  title: string;
  body: string;
}

/**
 * `## Slides` holds one `### ...` block per slide. A heading like "### 3" or "### Slide 3" is just a marker and the
 * first body line becomes the title; any other heading text is the title.
 */
export function parseSlides(body: string): Slide[] {
  const sec = section(body, "Slides");
  if (!sec) return [];
  const blocks = sec.split(/^###\s+/m).slice(1);
  return blocks
    .map((b) => {
      const [head, ...rest] = b.split("\n");
      let title = head.trim();
      let lines = rest.map((l) => l.trimEnd());
      if (/^(slide\s*)?\d+[.:)]?\s*$/i.test(title)) {
        const first = lines.findIndex((l) => l.trim());
        title = first >= 0 ? lines[first].trim() : "";
        lines = lines.slice(first + 1);
      } else title = title.replace(/^(slide\s*)?\d+\s*[.:)\-–—]\s*/i, "");
      return { title: title.replace(/^\*\*(.*)\*\*$/, "$1"), body: lines.join("\n").trim() };
    })
    .filter((s) => s.title || s.body);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>");

function bodyHtml(md: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    const m = l.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    if (m) list.push(m[2]);
    else {
      flush();
      if (l) out.push(`<p>${inline(l)}</p>`);
    }
  }
  flush();
  return out.join("");
}

function titleSize(t: string, cover: boolean): number {
  const n = t.length;
  if (cover) return n < 30 ? 112 : n < 60 ? 92 : n < 100 ? 74 : 60;
  return n < 30 ? 84 : n < 60 ? 70 : n < 100 ? 58 : 48;
}

export function slideHtml(brand: BrandConfig, handle: string, s: Slide, i: number, total: number): string {
  const v = brand.visual;
  const cover = i === 0;
  const last = i === total - 1 && total > 1;
  const bg = last ? v.accent : v.bg;
  const fg = last ? v.bg : v.fg;
  const headingFont = v.headingFont ?? v.font;
  const fonts = [...new Set([v.font, headingFont])].map((f) => `family=${encodeURIComponent(f)}:wght@400;600;800`).join("&");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=block">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1080px;height:1350px}
  body{background:${bg};color:${fg};font-family:'${v.font}',system-ui,-apple-system,'Segoe UI',sans-serif;
       padding:96px 92px 88px;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
  header{display:flex;justify-content:space-between;align-items:center;font-size:30px;font-weight:600;opacity:.75}
  header .dot{width:18px;height:18px;border-radius:50%;background:${last ? v.bg : v.accent}}
  main{flex:1;display:flex;flex-direction:column;justify-content:${cover ? "flex-end" : "center"};gap:44px;padding:40px 0}
  h1{font-family:'${headingFont}','${v.font}',system-ui,sans-serif;font-weight:800;line-height:1.04;letter-spacing:-.02em;
     font-size:${titleSize(s.title, cover)}px}
  h1 strong,h1 mark{color:${last ? v.bg : v.accent};background:none}
  .body{font-size:${s.body.length > 380 ? 32 : 38}px;line-height:1.38;display:flex;flex-direction:column;gap:22px;color:${last ? v.bg : v.fg}}
  .body p{opacity:.92}
  .body strong{color:${last ? v.bg : v.accent}}
  .body mark{background:${last ? v.bg : v.accent};color:${last ? v.accent : v.bg};padding:0 10px;border-radius:6px;font-weight:700}
  ul{list-style:none;display:flex;flex-direction:column;gap:18px}
  li{padding-left:44px;position:relative}
  li:before{content:"";position:absolute;left:0;top:.5em;width:22px;height:6px;border-radius:3px;background:${last ? v.bg : v.accent}}
  footer{display:flex;justify-content:space-between;align-items:center;font-size:28px;font-weight:600;opacity:.7}
  .bar{height:8px;border-radius:4px;background:${last ? v.bg : v.accent};width:${Math.round(((i + 1) / total) * 100)}%;margin-bottom:28px;opacity:.9}
</style></head><body>
<header><span>${esc(brand.name)}</span><span class="dot"></span></header>
<main><h1>${inline(s.title)}</h1>${s.body ? `<div class="body">${bodyHtml(s.body)}</div>` : ""}</main>
<div class="bar"></div>
<footer><span>${esc(handle)}</span><span>${total > 1 ? `${i + 1}/${total}${i < total - 1 ? " →" : ""}` : ""}</span></footer>
</body></html>`;
}

/** Render a carousel/image content item to PNGs under assets/<id>/ and record them as the item's media. */
export async function renderContent(ctx: Ctx, brand: string, id: string, opts: { handle?: string } = {}): Promise<string[]> {
  const item = getContent(ctx, brand, id);
  const cfg = getBrand(ctx, brand);
  let slides = parseSlides(item.body);
  if (!slides.length && item.format === "image") slides = [{ title: item.hook ?? item.title, body: "" }];
  if (!slides.length) throw new MktError(`content ${id} has no "## Slides" section with "### " slides`);
  const handle = opts.handle ?? (cfg.website ? cfg.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : cfg.name);
  const outDir = path.join(brandDir(ctx, brand), "assets", id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: chromePath(ctx), headless: true });
  const files: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    for (let i = 0; i < slides.length; i++) {
      await page.setContent(slideHtml(cfg, handle, slides[i], i, slides.length), { waitUntil: "load", timeout: 20_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const f = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1080, height: 1350 } });
      files.push(f);
    }
  } finally {
    await browser.close();
  }
  const rel = files.map((f) => path.relative(brandDir(ctx, brand), f));
  updateContent(ctx, brand, id, { media: rel });
  return files;
}
