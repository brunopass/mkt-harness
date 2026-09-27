import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Ctx } from "./config.js";
import { Account, AccountsFile, BrandConfig } from "./schemas.js";
import { assertBrand, audit, brandDir, brandFile, MktError, truncate, withLock, writeFileAtomic } from "./store.js";

export function listBrands(ctx: Ctx): string[] {
  const dir = path.join(ctx.ws, "brands");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "brand.yaml")))
    .sort();
}

export function getBrand(ctx: Ctx, brand: string): BrandConfig {
  assertBrand(ctx, brand);
  const raw = YAML.parse(fs.readFileSync(brandFile(ctx, brand, "brand.yaml"), "utf8")) ?? {};
  return BrandConfig.parse({ slug: brand, ...raw });
}

export function brandDoc(ctx: Ctx, brand: string, name: string): string {
  const f = brandFile(ctx, brand, name);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
}

export function listPersonas(ctx: Ctx, brand: string): string[] {
  const dir = brandFile(ctx, brand, "personas");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

export function createBrand(ctx: Ctx, slug: string, name: string, opts: { website?: string; languages?: string[]; timezone?: string } = {}): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) throw new MktError(`brand slug must be lowercase letters, digits, - and _`);
  const dest = brandDir(ctx, slug);
  if (fs.existsSync(path.join(dest, "brand.yaml"))) throw new MktError(`brand "${slug}" already exists at ${dest}`);
  const tpl = path.join(ctx.root, "templates", "brand");
  const vars: Record<string, string> = {
    slug,
    name,
    website: opts.website ?? "",
    languages: JSON.stringify(opts.languages ?? ["en"]),
    timezone: opts.timezone ?? ctx.config.timezone,
  };
  const copy = (from: string, to: string) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        copy(src, dst);
      } else {
        const text = fs.readFileSync(src, "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
        writeFileAtomic(dst, text);
      }
    }
  };
  fs.mkdirSync(dest, { recursive: true });
  copy(tpl, dest);
  for (const d of ["content", "assets", "trends", "reports"]) fs.mkdirSync(path.join(dest, d), { recursive: true });
  audit(ctx, "brand.create", { brand: slug, detail: { name } });
  return dest;
}

// ---------------------------------------------------------------- accounts

export function listAccounts(ctx: Ctx, brand?: string): (Account & { brand: string })[] {
  const brands = brand ? [brand] : listBrands(ctx);
  const out: (Account & { brand: string })[] = [];
  for (const b of brands) {
    const f = brandFile(ctx, b, "accounts.yaml");
    if (!fs.existsSync(f)) continue;
    const parsed = AccountsFile.safeParse(YAML.parse(fs.readFileSync(f, "utf8")) ?? {});
    if (!parsed.success) throw new MktError(`${path.relative(ctx.root, f)}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    for (const a of parsed.data.accounts) out.push({ ...a, brand: b });
  }
  return out;
}

/** Account ids are global: they name the Chrome profile, so two brands cannot share one. */
export function getAccount(ctx: Ctx, id: string): Account & { brand: string } {
  const a = listAccounts(ctx).find((x) => x.id === id);
  if (!a) throw new MktError(`unknown account "${id}" (add it to workspace/brands/<brand>/accounts.yaml or run: mkt account add)`);
  return a;
}

export function addAccount(ctx: Ctx, brand: string, account: Account): Account {
  assertBrand(ctx, brand);
  if (listAccounts(ctx).some((a) => a.id === account.id)) throw new MktError(`account id "${account.id}" already exists`);
  const f = brandFile(ctx, brand, "accounts.yaml");
  withLock(f, () => {
    const doc = fs.existsSync(f) ? YAML.parseDocument(fs.readFileSync(f, "utf8")) : new YAML.Document({ accounts: [] });
    if (!doc.has("accounts") || doc.get("accounts") == null) doc.set("accounts", doc.createNode([]));
    const seq = doc.get("accounts") as YAML.YAMLSeq;
    seq.flow = false; // the template's `accounts: []` would otherwise make every entry a one-line flow map
    const clean = Object.fromEntries(Object.entries(Account.parse(account)).filter(([, v]) => v !== undefined));
    seq.add(doc.createNode(clean));
    writeFileAtomic(f, doc.toString());
  });
  audit(ctx, "account.add", { brand, ref: account.id, detail: { platform: account.platform, handle: account.handle } });
  return account;
}

// ---------------------------------------------------------------- context pack

/**
 * Everything a writer needs in one call: identity, voice, the persona, offers, banned words and the freshest
 * customer language. Kept short on purpose; the full files are one Read away.
 */
export function brandContext(ctx: Ctx, brand: string, persona?: string, insights: { kind: string; text: string; quote?: string; weight: number }[] = []): string {
  const cfg = getBrand(ctx, brand);
  const personas = listPersonas(ctx, brand);
  const p = persona ?? personas[0];
  const parts = [
    `# ${cfg.name} (${cfg.slug})`,
    `languages: ${cfg.languages.join(", ")} | timezone: ${cfg.timezone}${cfg.website ? ` | ${cfg.website}` : ""}`,
    cfg.pillars.length ? `pillars: ${cfg.pillars.join(" / ")}` : "",
    cfg.banned.length ? `never say: ${cfg.banned.join(", ")}` : "",
    `personas: ${personas.join(", ") || "(none yet: run the customer-research skill)"}`,
    "",
    "## Brand",
    truncate(brandDoc(ctx, brand, "brand.md"), 5000),
    "## Voice",
    truncate(brandDoc(ctx, brand, "voice.md"), 4000),
    "## Offers",
    truncate(brandDoc(ctx, brand, "offers.md"), 3000),
  ];
  if (p && personas.includes(p)) parts.push(`## Persona: ${p}`, truncate(brandDoc(ctx, brand, `personas/${p}.md`), 5000));
  if (insights.length) {
    parts.push("## Customer language (latest, strongest first)");
    for (const i of insights) parts.push(`- [${i.kind}] ${i.text}${i.quote ? ` — "${i.quote}"` : ""}`);
  }
  return parts.filter((x) => x !== "").join("\n");
}
