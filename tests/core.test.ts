import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeEmailText } from "../src/channels/email.js";
import { brandContext, listAccounts } from "../src/core/brands.js";
import { captionFor, createContent, getContent, listContent, section, updateContent } from "../src/core/content.js";
import { listThreads, logMessages } from "../src/core/conversations.js";
import { detectOptOut, normHandle, normIdentifier, normPhone, suppress } from "../src/core/identity.js";
import { getLead, importLeadsCsv, parseCsv, updateLead, upsertLead } from "../src/core/leads.js";
import { approveOutbox, beginSend, draftOutbox, finishSend, getOutbox, recoverStuck, updateOutbox } from "../src/core/outbox.js";
import { checkPolicy, recordSend } from "../src/core/policy.js";
import { appendJsonl, readJsonl, updateJson } from "../src/core/store.js";
import { cronMatches, inQuietHours, quietHoursEnd } from "../src/core/time.js";
import { linreg, momentum, observe, parseFeed, parseTraffic, seriesStat } from "../src/core/trends.js";
import { parseImapUrl, stripQuoted } from "../src/inbox/sync.js";
import { parseSlides } from "../src/render/carousel.js";
import { human, makeWs } from "./helpers.js";

const lead = (ctx: ReturnType<typeof makeWs>, extra: Record<string, unknown> = {}) =>
  upsertLead(ctx, "acme", { name: "Jane", handles: { instagram: "@jane" }, source: { kind: "test" }, ...extra } as any).lead;

describe("store", () => {
  it("serialises read-modify-write and survives a torn jsonl line", () => {
    const ctx = makeWs();
    const f = path.join(ctx.ws, "n.json");
    for (let i = 0; i < 50; i++) updateJson<number[]>(f, [], (a) => void a.push(i));
    expect(JSON.parse(fs.readFileSync(f, "utf8"))).toHaveLength(50);
    const j = path.join(ctx.ws, "x.jsonl");
    appendJsonl(j, { a: 1 }, { a: 2 });
    fs.appendFileSync(j, '{"a": 3');
    expect(readJsonl(j)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("identity", () => {
  it("normalises handles, phones and identifiers", () => {
    expect(normHandle("https://www.instagram.com/Jane.Doe/")).toBe("jane.doe");
    expect(normHandle("@Jane")).toBe("jane");
    expect(normHandle("https://www.linkedin.com/in/jane-doe-123/")).toBe("jane-doe-123");
    expect(normPhone("+34 600 00 00 01")).toBe("+34600000001");
    expect(normPhone("0034 600000001")).toBe("+34600000001");
    expect(normIdentifier("Jane@Example.COM")).toBe("jane@example.com");
    expect(normIdentifier("instagram:@Jane")).toBe("instagram:jane");
    expect(() => normIdentifier("jane")).toThrow();
  });

  it("detects opt-outs in several languages without obvious false positives", () => {
    for (const t of ["STOP", "stop.", "Please unsubscribe me", "remove me from your list", "pare de me mandar mensagem", "quero me descadastrar", "sair", "por favor, darme de baja", "no me escribas más", "désabonnez-moi", "don't contact me again"])
      expect(detectOptOut(t), t).toBe("opt_out");
    for (const t of ["not interested, thanks", "não tenho interesse", "no me interesa"]) expect(detectOptOut(t), t).toBe("not_interested");
    for (const t of ["don't stop posting these!", "can we stop by your office?", "how do I stop my trial from renewing?", "love it"]) expect(detectOptOut(t), t).toBeNull();
  });
});

describe("leads", () => {
  it("dedupes across identifiers and never downgrades stage or consent on merge", () => {
    const ctx = makeWs();
    const a = upsertLead(ctx, "acme", { name: "Jane", handles: { instagram: "https://instagram.com/jane/" }, stage: "replied", consent: { email: "opt_in", whatsapp: "none" }, source: { kind: "comment" } } as any);
    expect(a.created).toBe(true);
    const b = upsertLead(ctx, "acme", { handles: { instagram: "@Jane" }, email: "jane@x.com", stage: "new", consent: { email: "none", whatsapp: "opt_in" } } as any);
    expect(b.created).toBe(false);
    expect(b.lead.id).toBe(a.lead.id);
    expect(b.lead.stage).toBe("replied");
    expect(b.lead.consent).toMatchObject({ email: "opt_in", whatsapp: "opt_in" });
    expect(b.lead.email).toBe("jane@x.com");
  });

  it("requires a source for new leads and protects do_not_contact from agents", () => {
    const ctx = makeWs();
    expect(() => upsertLead(ctx, "acme", { name: "Nobody", email: "n@x.com" } as any)).toThrow(/source/);
    const l = lead(ctx, { stage: "do_not_contact" });
    expect(() => updateLead(ctx, "acme", l.id, { stage: "new" })).toThrow(/do_not_contact/);
    expect(updateLead(human(ctx), "acme", l.id, { stage: "new" }).stage).toBe("new");
  });

  it("parses and imports CSV", () => {
    expect(parseCsv('name,email\n"Doe, Jane",jane@x.com\r\n"Bob ""B""",b@x.com\n')).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { name: 'Bob "B"', email: "b@x.com" },
    ]);
    const ctx = makeWs();
    const r = importLeadsCsv(ctx, "acme", "name,email,instagram,tags,consent_email\nJane,jane@x.com,@jane,vip|pt,legitimate_interest\nNo Contact,,,,\nJane again,JANE@x.com,,,\n", "event-list");
    expect(r).toEqual({ created: 1, merged: 1, skipped: 1 });
  });
});

describe("outbox + policy", () => {
  it("runs the full lifecycle: draft -> approval -> send -> lead/conversation bookkeeping", () => {
    const ctx = makeWs();
    const l = lead(ctx);
    const d = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "Hi Jane" });
    expect(d.status).toBe("pending_approval");
    expect(d.to?.handle).toBe("@jane"); // filled from the lead
    expect(beginSend(ctx, d.id).ok).toBe(false);
    approveOutbox(human(ctx), [d.id]);
    const b = beginSend(ctx, d.id);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(getOutbox(ctx, d.id).status).toBe("sending");
    const sent = finishSend(ctx, d.id, b.token, { ok: true, url: "https://instagram.com/direct/t/1" });
    expect(sent.status).toBe("sent");
    const after = getLead(ctx, "acme", l.id);
    expect(after).toMatchObject({ stage: "contacted", touches: 1 });
    expect(listThreads(ctx, "acme")[0]).toMatchObject({ threadKey: "instagram:jane", lastDirection: "out", needsReply: false });
  });

  it("editing an approved message sends it back for approval", () => {
    const ctx = makeWs();
    const d = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "v1" });
    approveOutbox(human(ctx), [d.id]);
    expect(updateOutbox(ctx, d.id, { scheduledFor: "2030-01-01T00:00:00.000Z" }).status).toBe("approved");
    expect(updateOutbox(ctx, d.id, { body: "v2" }).status).toBe("pending_approval");
  });

  it("enforces per-account rate limits and gaps as deferrals", () => {
    const ctx = makeWs({ limits: { x: { post: { perDay: 2, minGapSec: 600 } } } });
    const now = new Date("2026-09-28T10:00:00Z");
    const mk = () => {
      const d = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "hello" });
      approveOutbox(human(ctx), [d.id]);
      return getOutbox(ctx, d.id);
    };
    recordSend(ctx, { id: "a", account: "acme-x", kind: "post" }, new Date(now.getTime() - 60_000));
    const gap = checkPolicy(ctx, mk(), now);
    expect(gap).toMatchObject({ ok: false, block: false });
    expect((gap as any).reason).toMatch(/min gap/);
    recordSend(ctx, { id: "b", account: "acme-x", kind: "post" }, new Date(now.getTime() - 3_600_000));
    const cap = checkPolicy(ctx, mk(), new Date(now.getTime() + 3_600_000));
    expect((cap as any).reason).toMatch(/limit 2/);
    expect(Date.parse((cap as any).retryAt)).toBeGreaterThan(now.getTime());
  });

  it("defers cold outreach in quiet hours (brand timezone) but not posts", () => {
    const ctx = makeWs({ quietHours: { start: "21:00", end: "08:30" } });
    const l = lead(ctx);
    const night = new Date("2026-09-28T21:30:00Z"); // 23:30 in Madrid
    const dm = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "hi" });
    approveOutbox(human(ctx), [dm.id]);
    const p = checkPolicy(ctx, getOutbox(ctx, dm.id), night);
    expect(p).toMatchObject({ ok: false, block: false });
    expect(new Date((p as any).retryAt).toISOString()).toBe("2026-09-29T06:30:00.000Z"); // 08:30 Madrid
    const post = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-ig", body: "hello" });
    approveOutbox(human(ctx), [post.id]);
    expect(checkPolicy(ctx, getOutbox(ctx, post.id), night).ok).toBe(true);
  });

  it("requires consent for first WhatsApp contact and cold email", () => {
    const ctx = makeWs();
    const noConsent = lead(ctx, { handles: {}, phone: "+34 611 111 111", email: "jane@x.com" });
    const wa = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-wa", to: { leadId: noConsent.id }, body: "Olá" });
    approveOutbox(human(ctx), [wa.id]);
    expect(checkPolicy(ctx, getOutbox(ctx, wa.id))).toMatchObject({ ok: false, block: true });
    const em = draftOutbox(ctx, { brand: "acme", kind: "email", account: "acme-email", to: { leadId: noConsent.id }, subject: "Hi", body: "Hello" });
    approveOutbox(human(ctx), [em.id]);
    expect((checkPolicy(ctx, getOutbox(ctx, em.id)) as any).reason).toMatch(/cold email/);
    updateLead(ctx, "acme", noConsent.id, { consent: { email: "legitimate_interest", whatsapp: "opt_in", basis: "met at event" } });
    expect(checkPolicy(ctx, getOutbox(ctx, wa.id)).ok).toBe(true);
    expect(checkPolicy(ctx, getOutbox(ctx, em.id)).ok).toBe(true);
  });

  it("only allows replies to people who wrote first", () => {
    const ctx = makeWs();
    const r = draftOutbox(ctx, { brand: "acme", kind: "reply", account: "acme-wa", to: { phone: "+34 622 222 222" }, body: "Claro!" });
    approveOutbox(human(ctx), [r.id]);
    expect((checkPolicy(ctx, getOutbox(ctx, r.id)) as any).reason).toMatch(/inbound/);
    logMessages(ctx, "acme", [{ brand: "acme", account: "acme-wa", platform: "whatsapp", contact: { phone: "+34622222222" }, direction: "in", text: "Oi, quanto custa?" }]);
    expect(checkPolicy(ctx, getOutbox(ctx, r.id)).ok).toBe(true);
  });

  it("stops after max touches without a reply", () => {
    const ctx = makeWs({ outreach: { maxTouchesPerLead: 2, minHoursBetweenTouches: 0, emailFooter: "x" } });
    const l = lead(ctx);
    updateLead(ctx, "acme", l.id, { touches: 2, lastContactAt: "2026-01-01T00:00:00.000Z" });
    const d = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "bump" });
    approveOutbox(human(ctx), [d.id]);
    expect(checkPolicy(ctx, getOutbox(ctx, d.id))).toMatchObject({ ok: false, block: true });
  });

  it("an inbound opt-out suppresses the contact, closes the lead and cancels queued messages", () => {
    const ctx = makeWs();
    const l = lead(ctx);
    const queued = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { leadId: l.id }, body: "following up" });
    const [m] = logMessages(ctx, "acme", [{ brand: "acme", account: "acme-ig", platform: "instagram", contact: { handle: "jane" }, direction: "in", text: "Please stop messaging me" }]);
    expect(m.flags).toContain("opt_out");
    expect(m.leadId).toBe(l.id);
    expect(getLead(ctx, "acme", l.id).stage).toBe("do_not_contact");
    expect(getOutbox(ctx, queued.id).status).toBe("cancelled");
    expect(() => draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-ig", to: { handle: "@JANE" }, body: "x" })).toThrow(/suppressed/);
  });

  it("blocks approved items to someone suppressed after approval", () => {
    const ctx = makeWs();
    const d = draftOutbox(ctx, { brand: "acme", kind: "dm", account: "acme-li", to: { handle: "bob" }, body: "hi" });
    approveOutbox(human(ctx), [d.id]);
    suppress(ctx, ["linkedin:bob"], "asked by email");
    const b = beginSend(ctx, d.id);
    expect(b.ok).toBe(false);
    expect(getOutbox(ctx, d.id).status).toBe("blocked");
  });

  it("dedupes logged messages", () => {
    const ctx = makeWs();
    const msg = { brand: "acme", account: "acme-wa", platform: "whatsapp" as const, contact: { phone: "+34633" }, direction: "in" as const, text: "hola", at: "2026-09-27T10:00:10.000Z" };
    expect(logMessages(ctx, "acme", [msg, { ...msg }])).toHaveLength(1);
    expect(logMessages(ctx, "acme", [{ ...msg, at: "2026-09-27T10:00:40.000Z" }])).toHaveLength(0);
  });

  it("marks interrupted sends failed instead of retrying them", () => {
    const ctx = makeWs();
    const d = draftOutbox(ctx, { brand: "acme", kind: "post", account: "acme-x", body: "x" });
    approveOutbox(human(ctx), [d.id]);
    const t0 = new Date("2026-09-28T10:00:00Z");
    expect(beginSend(ctx, d.id, { now: t0 }).ok).toBe(true);
    expect(recoverStuck(ctx, 20, new Date(t0.getTime() + 30 * 60_000))).toHaveLength(1);
    expect(getOutbox(ctx, d.id)).toMatchObject({ status: "failed" });
  });

  it("adds the opt-out footer to cold email only", () => {
    const ctx = makeWs();
    const base = { id: "x", brand: "acme", account: "acme-email", platform: "email", body: "Hello", media: [], status: "approved", attempts: 0, createdBy: "t", createdAt: "", updatedAt: "" } as any;
    expect(composeEmailText(ctx, { ...base, kind: "email" })).toMatch(/reply "stop"/);
    expect(composeEmailText(ctx, { ...base, kind: "reply" })).toBe("Hello");
  });
});

describe("content", () => {
  it("round-trips frontmatter and body, and finds sections and captions", () => {
    const ctx = makeWs();
    const c = createContent(ctx, "acme", { title: "Five leaks", format: "carousel", platforms: ["instagram"] });
    expect(fs.existsSync(c.path)).toBe(true);
    expect(c.body).toMatch(/## Slides/);
    const u = updateContent(ctx, "acme", c.id, { status: "draft", body: "## Caption\nGeneric\n\n## Caption: linkedin\nFor LI\n", scores: { hook: 4 } });
    expect(getContent(ctx, "acme", c.id)).toMatchObject({ status: "draft", scores: { hook: 4 } });
    expect(captionFor(u, "linkedin")).toBe("For LI");
    expect(captionFor(u, "instagram")).toBe("Generic");
    expect(section(u.body, "missing")).toBeUndefined();
    expect(listContent(ctx, "acme", { status: ["draft"] })).toHaveLength(1);
  });

  it("parses slides with marker or titled headings", () => {
    const slides = parseSlides("## Slides\n\n### Big **hook**\nsub\n\n### 2\n**Point two**\n- a\n- b\n\n### Slide 3: Last\nCTA\n\n## Caption\nx");
    expect(slides).toEqual([
      { title: "Big **hook**", body: "sub" },
      { title: "Point two", body: "- a\n- b" },
      { title: "Last", body: "CTA" },
    ]);
  });

  it("builds a brand context pack", () => {
    const ctx = makeWs();
    const pack = brandContext(ctx, "acme", "founder", [{ kind: "pain", text: "misses DMs", quote: "I forget to reply", weight: 5 }]);
    expect(pack).toMatch(/never say: guaranteed/);
    expect(pack).toMatch(/Persona: founder/);
    expect(pack).toMatch(/I forget to reply/);
    expect(listAccounts(ctx, "acme")).toHaveLength(5);
  });
});

describe("trends", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 8, 1 + d)).toISOString();
  it("fits growth and classifies stages", () => {
    expect(linreg([0, 1, 2], [1, 3, 5])).toMatchObject({ slope: 2, intercept: 1, r2: 1 });
    const growing = seriesStat([0, 2, 4, 6, 8].map((d, i) => ({ at: day(d), value: 100 * 1.5 ** i })), { topic: "t", source: "s", metric: "views" });
    expect(growing.stage).toBe("surging");
    expect(growing.forecast7d!).toBeGreaterThan(growing.lastValue);
    const fading = seriesStat([0, 3, 6, 9].map((d, i) => ({ at: day(d), value: 1000 / 2 ** i })), { topic: "t", source: "s", metric: "views" });
    expect(fading.stage).toBe("fading");
    const peaking = seriesStat([100, 400, 900, 600].map((v, i) => ({ at: day(i * 2), value: v })), { topic: "t", source: "s", metric: "views" });
    expect(peaking.stage).toBe("peaking");
    const rank = seriesStat([50, 30, 10, 3].map((v, i) => ({ at: day(i * 2), value: v })), { topic: "t", source: "s", metric: "rank" });
    expect(rank.weeklyGrowth!).toBeGreaterThan(0);
  });

  it("aggregates topics across sources", () => {
    const ctx = makeWs();
    const obs = [];
    for (let i = 0; i < 5; i++) {
      obs.push({ topic: "AI receptionist", source: "google_trends_BR", metric: "approx_traffic", value: 200 * 1.6 ** i, at: day(i * 2) });
      obs.push({ topic: "ai receptionist", source: "tiktok_creative_center", metric: "posts", value: 1000 + 400 * i, at: day(i * 2) });
      obs.push({ topic: "fax machines", source: "google_trends_BR", metric: "approx_traffic", value: 500 - 80 * i, at: day(i * 2) });
    }
    observe(ctx, "acme", obs);
    const m = momentum(ctx, "acme", { now: new Date(day(10)), windowDays: 30 });
    expect(m[0].topic).toBe("ai receptionist");
    expect(m[0].sources).toBe(2);
    expect(["surging", "rising"]).toContain(m[0].stage);
    expect(m.find((t) => t.topic === "fax machines")!.stage).toBe("fading");
  });

  it("parses Google Trends RSS and traffic strings", () => {
    const xml = `<rss><channel><item><title>criciúma x avaí</title><ht:approx_traffic>5000+</ht:approx_traffic><pubDate>Sun, 27 Sep 2026 06:10:00 -0700</pubDate>
      <ht:news_item><ht:news_item_title>Onde assistir &amp; horário</ht:news_item_title><ht:news_item_url>https://x.test/a</ht:news_item_url></ht:news_item></item>
      <item><title><![CDATA[Other & more]]></title><ht:approx_traffic>20K+</ht:approx_traffic></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items[0]).toMatchObject({ title: "criciúma x avaí", traffic: 5000, news: [{ title: "Onde assistir & horário", url: "https://x.test/a" }] });
    expect(items[1]).toMatchObject({ title: "Other & more", traffic: 20000 });
    expect(parseTraffic("1M+")).toBe(1_000_000);
    expect(parseTraffic("2,000+")).toBe(2000);
  });
});

describe("time", () => {
  it("matches cron in a timezone with standard day semantics", () => {
    const madrid9 = new Date("2026-09-28T07:00:00Z"); // Monday 09:00 Madrid (CEST)
    expect(cronMatches("0 9 * * 1-5", madrid9, "Europe/Madrid")).toBe(true);
    expect(cronMatches("0 9 * * 0,6", madrid9, "Europe/Madrid")).toBe(false);
    expect(cronMatches("*/15 9 * * *", new Date("2026-09-28T07:45:00Z"), "Europe/Madrid")).toBe(true);
    expect(cronMatches("0 9 1 * 1", madrid9, "Europe/Madrid")).toBe(true); // dom OR dow
    expect(cronMatches("0 9 * * 7", new Date("2026-09-27T07:00:00Z"), "Europe/Madrid")).toBe(true); // 7 = Sunday
    expect(() => cronMatches("61 * * * *", madrid9, "UTC")).toThrow();
  });

  it("handles quiet hours across midnight", () => {
    const q = { start: "21:00", end: "08:30" };
    expect(inQuietHours(new Date("2026-09-28T22:00:00Z"), "Europe/Madrid", q)).toBe(true);
    expect(inQuietHours(new Date("2026-09-28T10:00:00Z"), "Europe/Madrid", q)).toBe(false);
    expect(quietHoursEnd(new Date("2026-09-28T22:00:00Z"), "Europe/Madrid", q).toISOString()).toBe("2026-09-29T06:30:00.000Z");
    expect(inQuietHours(new Date(), "UTC", null)).toBe(false);
  });
});

describe("email parsing", () => {
  it("strips quoted replies and parses IMAP urls", () => {
    expect(stripQuoted("Yes, Tuesday works.\n\nOn Mon, 28 Sep 2026 at 10:00, Ana <a@x.com> wrote:\n> old")).toBe("Yes, Tuesday works.");
    expect(stripQuoted("Pode ser!\nEm seg., 28 de set. de 2026 às 10:00, Ana escreveu:\n> antigo")).toBe("Pode ser!");
    expect(parseImapUrl("imaps://me%40x.com:p%40ss@imap.x.com")).toEqual({ host: "imap.x.com", port: 993, secure: true, user: "me@x.com", pass: "p@ss" });
  });
});
