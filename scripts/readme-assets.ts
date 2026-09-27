/**
 * Renders the README images from HTML with the same headless Chrome the harness uses:
 *   docs/assets/banner.png          hero: a press-proof sheet with real rendered slides and the "OK to send" stamp
 *   docs/assets/contact-sheet.png   every slide of the example carousel as a contact sheet
 * Run: npm run readme:assets   (after `mkt content render example c_example01`)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "../src/browser/chrome.js";
import { loadCtx } from "../src/core/config.js";

const ctx = loadCtx();
const slidesDir = path.join(ctx.ws, "brands", "example", "assets", "c_example01");
const outDir = path.join(ctx.root, "docs", "assets");
fs.mkdirSync(outDir, { recursive: true });

const slides = fs
  .readdirSync(slidesDir)
  .filter((f) => f.endsWith(".png"))
  .sort()
  .map((f) => `data:image/png;base64,${fs.readFileSync(path.join(slidesDir, f)).toString("base64")}`);
if (slides.length < 3) throw new Error(`render the example carousel first: mkt content render example c_example01`);

const T = { paper: "#ECEEF1", ink: "#16161A", cyan: "#00A0DF", magenta: "#E6007E", yellow: "#FFE500" };

const fonts = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=block">`;

/** Registration target: circle + crosshair, the mark printers align plates on. */
const reg = (x: number, y: number) =>
  `<svg class="reg" style="left:${x}px;top:${y}px" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="8" fill="none" stroke="${T.ink}" stroke-width="1.2"/><path d="M15 0v30M0 15h30" stroke="${T.ink}" stroke-width="1.2"/></svg>`;

/** Crop marks: short lines just outside each corner of a box. */
const crops = (x: number, y: number, w: number, h: number, gap = 8, len = 16) => {
  const l = (x1: number, y1: number, x2: number, y2: number) => `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
  return [
    l(x - gap - len, y, x - gap, y), l(x, y - gap - len, x, y - gap),
    l(x + w + gap, y, x + w + gap + len, y), l(x + w, y - gap - len, x + w, y - gap),
    l(x - gap - len, y + h, x - gap, y + h), l(x, y + h + gap, x, y + h + gap + len),
    l(x + w + gap, y + h, x + w + gap + len, y + h), l(x + w, y + h + gap, x + w, y + h + gap + len),
  ].join("");
};

const colorBar = (swatch: number) => {
  const cells = [T.cyan, T.magenta, T.yellow, T.ink, "#80D0EF", "#F380BF", "#FFF280", "#8B8B8D"];
  return `<div class="bar">${cells.map((c) => `<i style="background:${c};width:${swatch}px;height:${swatch}px"></i>`).join("")}</div>`;
};

const base = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${T.paper};color:${T.ink};font-family:'Archivo',system-ui,sans-serif;position:relative;overflow:hidden;
       -webkit-font-smoothing:antialiased;font-variation-settings:'wdth' 100}
  .reg{position:absolute}
  .bar{display:flex;gap:0}
  .bar i{display:block}
  svg.marks{position:absolute;inset:0;stroke:${T.ink};stroke-width:1;fill:none}
`;

function bannerHtml(): string {
  const W = 1280, H = 640;
  const sw = 180, sh = 225; // 4:5 proofs
  const step = 170, right = 96;
  const px = W - right - (step * 2 + sw), py = 150;
  const picks = [slides[0], slides[2], slides[slides.length - 1]];
  const proofs = picks
    .map((src, i) => `<img class="proof" src="${src}" style="left:${px + i * step}px;top:${py + (i % 2) * 18}px;width:${sw}px;height:${sh}px;z-index:${i + 1}">`)
    .join("");
  const groupW = step * 2 + sw, groupH = sh + 18;
  const steps = ["research", "plan", "discuss", "ask", "execute"];
  return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base}
  body{width:${W}px;height:${H}px}
  .word{position:absolute;left:84px;top:146px;font-weight:850;font-size:124px;line-height:.86;letter-spacing:-.012em;
        font-variation-settings:'wdth' 62}
  .tag{position:absolute;left:88px;top:298px;width:500px;font-size:27px;line-height:1.32;font-weight:420}
  .who{position:absolute;left:88px;top:448px;font-size:17px;line-height:1.5;font-weight:500;opacity:.62;width:520px}
  .proof{position:absolute;border:7px solid #fff;box-shadow:0 1px 1px rgba(22,22,26,.18),0 14px 30px -12px rgba(22,22,26,.45)}
  .stamp{position:absolute;left:${px + step * 2 - 6}px;top:${py + sh - 22}px;z-index:9;transform:rotate(-9deg);color:${T.magenta};white-space:nowrap;
         border:4px solid ${T.magenta};border-radius:10px;padding:8px 18px 7px;text-align:center;mix-blend-mode:multiply;
         background:rgba(236,238,241,.35)}
  .stamp b{display:block;font-size:34px;font-weight:900;letter-spacing:.04em;font-variation-settings:'wdth' 75;line-height:1}
  .stamp span{display:block;font-size:14px;font-weight:600;border-top:2px solid ${T.magenta};margin-top:6px;padding-top:4px}
  .foot{position:absolute;left:88px;right:88px;bottom:62px;display:flex;align-items:center;justify-content:space-between}
  .flow{display:flex;align-items:center;font-size:17px;font-weight:600}
  .flow em{font-style:normal;display:flex;align-items:center}
  .flow em+em:before{content:"";display:block;width:34px;height:1.5px;background:${T.ink};opacity:.45;margin:0 12px}
  .flow .ask{color:${T.magenta}}
  .flow .ask:after{content:"";width:9px;height:9px;border-radius:50%;background:${T.magenta};margin-left:7px}
  </style></head><body>
  ${reg(26, 26)}${reg(W - 56, 26)}${reg(26, H - 56)}${reg(W - 56, H - 56)}
  <svg class="marks" width="${W}" height="${H}">${crops(px, py, groupW, groupH, 14, 18)}</svg>
  <div class="word">mkt-harness</div>
  <div class="tag">An AI marketing team for Claude Code and Codex. It researches, plans and writes. You approve. It publishes.</div>
  <div class="who">Brand and customer research, trends, scripts and carousels, leads, outreach, inbox replies, and posting to many accounts from real Chrome windows.</div>
  ${proofs}
  <div class="stamp"><b>OK TO SEND</b><span>approved by a human</span></div>
  <div class="foot">${colorBar(20)}<div class="flow">${steps.map((s) => `<em class="${s === "ask" ? "ask" : ""}">${s}</em>`).join("")}</div></div>
  </body></html>`;
}

function contactSheetHtml(): string {
  const fw = 196, fh = 245, gap = 30, mx = 70, top = 96;
  const W = mx * 2 + slides.length * fw + (slides.length - 1) * gap;
  const H = top + fh + 92;
  const frames = slides
    .map((src, i) => {
      const x = mx + i * (fw + gap);
      return `<img class="frame" src="${src}" style="left:${x}px;top:${top}px;width:${fw}px;height:${fh}px"><div class="num" style="left:${x}px;top:${top + fh + 16}px">${i + 1}</div>`;
    })
    .join("");
  const marks = slides.map((_, i) => crops(mx + i * (fw + gap), top, fw, fh, 5, 9)).join("");
  // grease-pencil loop around the pick (frame 1): a wobbly ellipse that overshoots where it closes, like a hand
  const cx = mx + fw / 2, cy = top + fh / 2, rx = fw / 2 + 20, ry = fh / 2 + 22, tilt = (-5 * Math.PI) / 180;
  const pts: string[] = [];
  for (let i = 0; i <= 90; i++) {
    const t = 3.6 + (i / 90) * (2 * Math.PI + 0.55);
    const wob = 1 + 0.03 * Math.sin(3 * t + 1) + 0.018 * Math.sin(5 * t) + (i > 80 ? (i - 80) * 0.006 : 0);
    const x = rx * wob * Math.cos(t), y = ry * wob * Math.sin(t);
    pts.push(`${(cx + x * Math.cos(tilt) - y * Math.sin(tilt)).toFixed(1)} ${(cy + x * Math.sin(tilt) + y * Math.cos(tilt)).toFixed(1)}`);
  }
  const loop = `M ${pts.join(" L ")}`;
  return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base}
  body{width:${W}px;height:${H}px}
  .frame{position:absolute;border:5px solid #fff;box-shadow:0 1px 1px rgba(22,22,26,.16),0 10px 22px -12px rgba(22,22,26,.4)}
  .num{position:absolute;width:${fw}px;text-align:center;font-size:15px;font-weight:600;opacity:.7}
  .cap{position:absolute;left:${mx}px;top:34px;font-size:18px;font-weight:600}
  .cap span{font-weight:420;opacity:.65;margin-left:10px}
  .bar{position:absolute;right:${mx}px;top:36px}
  svg.pencil{position:absolute;inset:0;fill:none;stroke:${T.magenta};stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
  </style></head><body>
  <div class="cap">content_render<span>one Markdown file in, seven on-brand 1080 × 1350 slides out</span></div>
  ${colorBar(14)}
  <svg class="marks" width="${W}" height="${H}">${marks}</svg>
  ${frames}
  <svg class="pencil" width="${W}" height="${H}"><path d="${loop}"/></svg>
  </body></html>`;
}

async function shoot(html: string, file: string, w: number, h: number): Promise<void> {
  const browser = await chromium.launch({ executablePath: chromePath(ctx), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
  } finally {
    await browser.close();
  }
  console.log(`${path.relative(ctx.root, file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

const sheetW = 70 * 2 + slides.length * 196 + (slides.length - 1) * 30;
await shoot(bannerHtml(), path.join(outDir, "banner.png"), 1280, 640);
await shoot(contactSheetHtml(), path.join(outDir, "contact-sheet.png"), sheetW, 96 + 245 + 92);
