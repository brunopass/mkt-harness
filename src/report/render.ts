import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";
import { getBrand, listBrands } from "../core/brands.js";
import type { Ctx } from "../core/config.js";
import { openExternal } from "../core/os.js";
import { MktError, writeFileAtomic } from "../core/store.js";

/**
 * Markdown deliverables (reports, plans, radars, research) -> a styled HTML page next to them, opened in the browser.
 * The Markdown may quote the web (scans, reviews, DMs), so the page never runs anything from it: raw HTML is shown as
 * text and only http(s)/mailto/relative links survive.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function safeHref(href: string | null | undefined, kind: "link" | "image"): string | undefined {
  const h = (href ?? "").trim();
  if (!h) return undefined;
  // strip control characters and whitespace browsers ignore inside schemes ("java\tscript:")
  const probe = h.replace(/[\u0000- \u007f]/g, "").toLowerCase();
  if (/^https?:\/\//.test(probe)) return h;
  if (kind === "link" && (/^mailto:/.test(probe) || probe.startsWith("#"))) return h;
  if (/^[a-z][a-z0-9+.-]*:/.test(probe) || probe.startsWith("//")) return undefined; // javascript:, data:, file:, vbscript:, protocol-relative
  return h; // relative path
}

function markdownToHtml(md: string): { html: string; mermaid: boolean } {
  let mermaid = false;
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return esc(token.text);
      },
      link(this: any, token: Tokens.Link) {
        const text = this.parser.parseInline(token.tokens);
        const href = safeHref(token.href, "link");
        if (!href) return text;
        const external = /^https?:/i.test(href);
        return `<a href="${esc(href)}"${token.title ? ` title="${esc(token.title)}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
      },
      image(token: Tokens.Image) {
        const href = safeHref(token.href, "image");
        if (!href) return esc(token.text ?? "");
        return `<img src="${esc(href)}" alt="${esc(token.text ?? "")}" loading="lazy">`;
      },
      code(token: Tokens.Code) {
        if ((token.lang ?? "").trim() === "mermaid") {
          mermaid = true;
          return `<pre class="mermaid">${esc(token.text)}</pre>`;
        }
        return `<pre><code>${esc(token.text)}</code></pre>`;
      },
    },
  });
  return { html: marked.parse(md, { async: false }) as string, mermaid };
}

/** Deliverables live in the workspace; refuse anything else (including symlinks pointing out of it). */
export function resolveReport(ctx: Ctx, file: string): string {
  const ws = fs.realpathSync(ctx.ws);
  const abs = path.resolve(ctx.root, file);
  if (!fs.existsSync(abs)) throw new MktError(`no such file: ${file}`);
  const real = fs.realpathSync(abs);
  if (!real.startsWith(ws + path.sep)) throw new MktError(`${file} is outside the workspace`);
  if (!/\.(md|markdown)$/i.test(real)) throw new MktError(`${file} is not a Markdown file`);
  if (fs.statSync(real).size > 5_000_000) throw new MktError(`${file} is too large to render`);
  return real;
}

function brandOf(ctx: Ctx, file: string): string | undefined {
  const rel = path.relative(fs.realpathSync(path.join(ctx.ws, "brands")), file);
  const b = rel.split(path.sep)[0];
  return !rel.startsWith("..") && listBrands(ctx).includes(b) ? b : undefined;
}

export function renderReport(ctx: Ctx, file: string): { html: string; title: string } {
  const src = resolveReport(ctx, file);
  const md = fs.readFileSync(src, "utf8").replace(/^---\n[\s\S]*?\n---\n/, ""); // content items carry YAML frontmatter
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(src, path.extname(src))).replace(/[*_`]/g, "").trim();
  const brand = brandOf(ctx, src);
  const b = brand ? getBrand(ctx, brand) : undefined;
  const accent = /^#[0-9a-f]{6}$/i.test(b?.visual.accent ?? "") ? b!.visual.accent : "#e6007e";
  const font = /^[A-Za-z0-9 _-]{2,40}$/.test(b?.visual.font ?? "") ? b!.visual.font : "Inter";
  const heading = /^[A-Za-z0-9 _-]{2,40}$/.test(b?.visual.headingFont ?? "") ? b!.visual.headingFont! : font;
  const fonts = [...new Set([font, heading])].map((f) => `family=${encodeURIComponent(f)}:wght@400;600;800`).join("&");
  const { html: body, mermaid } = markdownToHtml(md);
  // the only inline script, allowed by its hash: nothing injected inline can run
  const init = "mermaid.initialize({startOnLoad:true,securityLevel:'strict',theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'default'})";
  const initHash = crypto.createHash("sha256").update(init).digest("base64");
  const stamp = new Date(fs.statSync(src).mtime).toISOString().slice(0, 16).replace("T", " ");
  const html = `<!doctype html>
<html lang="${esc(b?.languages?.[0] ?? "en")}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;${mermaid ? ` script-src https://cdn.jsdelivr.net 'sha256-${initHash}';` : ""}">
<title>${esc(title)}${b ? ` · ${esc(b.name)}` : ""}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
<style>
  :root{--bg:#fbfbfa;--fg:#1a1a1c;--muted:#6b6b72;--line:#e6e6e3;--card:#ffffff;--accent:${accent};--code:#f3f3f1}
  @media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececef;--muted:#9a9aa3;--line:#2a2a2f;--card:#1a1a1d;--code:#202024}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 '${font}',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
  header{border-bottom:1px solid var(--line);padding:18px 24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--muted)}
  header b{color:var(--fg)}
  header .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:middle}
  main{max-width:860px;margin:0 auto;padding:32px 24px 64px}
  h1,h2,h3{font-family:'${heading}','${font}',system-ui,sans-serif;line-height:1.2}
  h1{font-size:2.1rem;margin:.2em 0 .6em;letter-spacing:-.01em}
  h2{font-size:1.4rem;margin:2em 0 .6em;padding-top:.6em;border-top:1px solid var(--line)}
  h3{font-size:1.1rem;margin:1.6em 0 .4em}
  a{color:var(--accent)}
  table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.94rem;display:block;overflow-x:auto}
  th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{font-weight:600;border-bottom:2px solid var(--fg)}
  code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.9em}
  pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:.88rem}
  pre code{background:none;padding:0}
  pre.mermaid{background:var(--card);text-align:center}
  blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--accent);color:var(--muted)}
  img{max-width:100%;max-height:560px;width:auto;height:auto;border-radius:6px;display:block;margin:1em 0}
  li{margin:.2em 0}
  hr{border:0;border-top:1px solid var(--line);margin:2em 0}
  footer{max-width:860px;margin:0 auto;padding:0 24px 40px;color:var(--muted);font-size:13px}
</style></head><body>
<header><span><span class="dot"></span><b>${esc(b?.name ?? "mkt-harness")}</b></span><span>updated ${esc(stamp)} UTC</span></header>
<main>${body}</main>
<footer>Generated by mkt-harness from ${esc(path.relative(ctx.root, src))}. The Markdown file is the source; edit it, not this page.</footer>
${mermaid ? `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><script>${init}</script>` : ""}
</body></html>
`;
  return { html, title };
}

/** Write <name>.html next to the Markdown (so its relative images keep working); return the path. */
export function writeReport(ctx: Ctx, file: string): { html: string; title: string; url: string } {
  const src = resolveReport(ctx, file);
  const { html, title } = renderReport(ctx, src);
  const out = src.replace(/\.(md|markdown)$/i, ".html");
  writeFileAtomic(out, html);
  return { html: out, title, url: `file://${out}` };
}

/** Open a local file in the default browser (see openExternal). */
export function openInBrowser(target: string): boolean {
  return openExternal(target);
}
