import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { ROOT } from "./helpers.js";

/** Skills and subagents are prompts: this keeps them pointing at tools and files that exist. */

const server = fs.readFileSync(path.join(ROOT, "src/mcp/server.ts"), "utf8");
const TOOLS = new Set([...server.matchAll(/tool\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
const TOOL_LIKE = /\b((?:brand|account|content|lead|outbox|inbox|conversation|insight|trend|suppression|policy|browser)_[a-z_]+|suppress)\b/g;
const BUILTIN = new Set(["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch", "Bash", "Skill", "Task", "Agent", "NotebookEdit", "TodoWrite"]);

function frontmatter(file: string): { meta: any; body: string } {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: no frontmatter`);
  return { meta: YAML.parse(m[1]), body: m[2] };
}

function unknownTools(text: string): string[] {
  // only code spans: prose like "lead_gen" in a sentence is not a tool call
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).join(" ");
  return [...new Set([...spans.matchAll(TOOL_LIKE)].map((m) => m[1]))].filter((t) => !TOOLS.has(t) && !/^(content|lead|trend|brand)_(id|ids|stage|score|name|slug)$/.test(t));
}

describe("skills", () => {
  const dir = path.join(ROOT, "skills");
  const skills = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());

  it("has the planned skills", () => {
    expect(TOOLS.size).toBeGreaterThan(40);
    for (const s of ["brand-foundation", "customer-research", "competitor-intel", "trend-radar", "content-strategy", "idea-engine", "script-writer", "repurpose", "lead-magnet", "lead-gen", "outreach", "inbox", "publish", "browser-ops", "analytics-review", "brand-development"])
      expect(skills).toContain(s);
  });

  for (const s of skills) {
    it(`${s}: valid frontmatter, real tools, existing references`, () => {
      const file = path.join(dir, s, "SKILL.md");
      const { meta, body } = frontmatter(file);
      expect(meta.name).toBe(s);
      expect(typeof meta.description).toBe("string");
      expect(meta.description.length).toBeGreaterThan(40);
      expect(meta.description.length).toBeLessThanOrEqual(1024);
      const all = [body, ...listMd(path.join(dir, s, "references")).map((f) => fs.readFileSync(f, "utf8"))].join("\n");
      expect(unknownTools(all), "unknown MCP tools referenced").toEqual([]);
      for (const ref of new Set([...body.matchAll(/\]\((references\/[^)#]+)\)/g, )].map((m) => m[1]))) expect(fs.existsSync(path.join(dir, s, ref)), ref).toBe(true);
    });
  }
});

describe("subagents", () => {
  const dir = path.join(ROOT, ".claude", "agents");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];

  it("exist", () => {
    for (const a of ["researcher", "strategist", "copywriter", "editor", "sdr", "community", "publisher"]) expect(files).toContain(`${a}.md`);
  });

  for (const f of files) {
    it(`${f}: tools exist and none can approve`, () => {
      const { meta, body } = frontmatter(path.join(dir, f));
      expect(meta.name).toBe(f.replace(/\.md$/, ""));
      const tools: string[] = String(meta.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        if (t.startsWith("mcp__mkt__")) expect(TOOLS.has(t.slice(10)), t).toBe(true);
        else if (!t.startsWith("mcp__")) expect(BUILTIN.has(t), t).toBe(true);
      }
      expect(tools).not.toContain("mcp__mkt__outbox_approve");
      expect(tools).not.toContain("Bash");
      expect(unknownTools(body)).toEqual([]);
    });
  }
});

function listMd(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listMd(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : []));
}
