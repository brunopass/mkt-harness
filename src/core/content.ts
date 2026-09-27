import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Ctx } from "./config.js";
import { ContentMeta, type ContentItem } from "./schemas.js";
import { assertBrand, audit, brandFile, MktError, newId, nowIso, slugify, withLock, writeFileAtomic } from "./store.js";

const contentDir = (ctx: Ctx, brand: string) => brandFile(ctx, brand, "content");

export function parseContent(text: string, file: string): ContentItem {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new MktError(`${file}: missing YAML frontmatter`);
  const meta = ContentMeta.parse(YAML.parse(m[1]) ?? {});
  return { ...meta, body: m[2].replace(/^\n+/, ""), path: file };
}

export function serializeContent(item: ContentItem | (ContentMeta & { body: string })): string {
  const { body, ...meta } = item as ContentItem;
  delete (meta as any).path;
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trimEnd()}\n`;
}

function findFile(ctx: Ctx, brand: string, id: string): string {
  const dir = contentDir(ctx, brand);
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => n === `${id}.md` || n.startsWith(`${id}--`)) : undefined;
  if (!f) throw new MktError(`content "${id}" not found in ${brand}`);
  return path.join(dir, f);
}

export function getContent(ctx: Ctx, brand: string, id: string): ContentItem {
  assertBrand(ctx, brand);
  const f = findFile(ctx, brand, id);
  return parseContent(fs.readFileSync(f, "utf8"), f);
}

export function listContent(ctx: Ctx, brand: string, filter: { status?: string[]; format?: string; pillar?: string; persona?: string } = {}): ContentItem[] {
  assertBrand(ctx, brand);
  const dir = contentDir(ctx, brand);
  if (!fs.existsSync(dir)) return [];
  const out: ContentItem[] = [];
  for (const n of fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const f = path.join(dir, n);
    let item: ContentItem;
    try {
      item = parseContent(fs.readFileSync(f, "utf8"), f);
    } catch {
      continue; // a hand-edited file with broken frontmatter should not hide the others
    }
    if (filter.status?.length && !filter.status.includes(item.status)) continue;
    if (filter.format && item.format !== filter.format) continue;
    if (filter.pillar && item.pillar !== filter.pillar) continue;
    if (filter.persona && item.persona !== filter.persona) continue;
    out.push(item);
  }
  return out;
}

export type ContentInput = Partial<Omit<ContentMeta, "id" | "brand" | "createdAt" | "updatedAt">> & { title: string; body?: string };

export function createContent(ctx: Ctx, brand: string, input: ContentInput): ContentItem {
  assertBrand(ctx, brand);
  const id = newId("c");
  const at = nowIso();
  const meta = ContentMeta.parse({ ...input, id, brand, createdAt: at, updatedAt: at });
  const file = path.join(contentDir(ctx, brand), `${id}--${slugify(input.title) || "untitled"}.md`);
  const item: ContentItem = { ...meta, body: input.body ?? defaultBody(meta.format), path: file };
  writeFileAtomic(file, serializeContent(item));
  audit(ctx, "content.create", { brand, ref: id, detail: { title: meta.title, status: meta.status, format: meta.format } });
  return item;
}

export function updateContent(ctx: Ctx, brand: string, id: string, patch: Partial<ContentInput> & { body?: string; appendBody?: string }): ContentItem {
  const f = findFile(ctx, brand, id);
  return withLock(f, () => {
    const cur = parseContent(fs.readFileSync(f, "utf8"), f);
    const { body, appendBody, ...metaPatch } = patch;
    const next: ContentItem = {
      ...cur,
      ...(ContentMeta.partial().parse(metaPatch) as Partial<ContentMeta>),
      id: cur.id,
      brand: cur.brand,
      createdAt: cur.createdAt,
      updatedAt: nowIso(),
      body: body ?? cur.body,
      path: f,
    };
    if (appendBody) next.body = `${next.body.trimEnd()}\n\n${appendBody.trim()}\n`;
    ContentMeta.parse(next);
    writeFileAtomic(f, serializeContent(next));
    audit(ctx, "content.update", { brand, ref: id, detail: { fields: Object.keys(patch) } });
    return next;
  });
}

/** Extract a `## Heading` section of the body (case-insensitive). */
export function section(body: string, heading: string): string | undefined {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const m = re.exec(body);
  if (!m) return undefined;
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Caption for a platform: `## Caption: <platform>` wins, then `## Caption`, then the hook. */
export function captionFor(item: ContentItem, platform: string): string {
  return section(item.body, `Caption: ${platform}`) ?? section(item.body, "Caption") ?? item.hook ?? item.title;
}

function defaultBody(format: string): string {
  const common = ["## Brief", "", "- Persona / pain:", "- Promise (one line):", "- Proof:", "- CTA:", "", "## Caption", ""];
  if (["reel", "short", "video", "story", "live"].includes(format))
    return [...common.slice(0, 7), "## Script", "", "| t | visual | voiceover / on-screen text |", "|---|---|---|", "| 0-3s | | HOOK: |", "", "## Caption", ""].join("\n");
  if (format === "carousel") return [...common.slice(0, 7), "## Slides", "", "### Slide 1", "", "### Slide 2", "", "## Caption", ""].join("\n");
  return common.join("\n");
}
