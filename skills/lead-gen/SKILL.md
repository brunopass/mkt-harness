---
name: lead-gen
description: "Find, qualify and record prospects that fit the ICP: engagers on our posts, keyword commenters, competitor engagers, hashtags, LinkedIn search, communities, directories and events; score fit 0-100, write personalisation notes and upsert leads with source and consent basis. Use for \"find leads\", \"prospect\", \"build a lead list\", \"who should we reach out to\", \"import this list\". Not for writing/sending messages (outreach) or answering inbound (inbox)."
---

# lead-gen

A small list of the right people with a real reason to talk beats a big scraped list. Global rules:
[AGENTS.md](../../AGENTS.md) — especially data minimisation and consent.

## Inputs
- `brand`, persona(s) (qualification section of `personas/<p>.md`), target count (default 20 per run),
  geography/language, sources allowed by the human.

## Sources, best first
1. **Warm**: people who engaged with us — commenters, DM senders, story repliers, new followers who match ICP,
   webinar attendees. `conversation_list {brand}`; our posts' comments via the browser.
2. **Keyword commenters** from lead-magnet posts (they asked — see lead-magnet).
3. **Competitor/adjacent engagers**: people commenting substantively on competitors' or complementary creators'
   posts about the problem (not just "🔥").
4. **LinkedIn search** (B2B): title + industry + company size + geography; recent posters about the pain first.
5. **Hashtags / locations** (B2C/local): recent posts under niche hashtags or geo-tags showing the trigger.
6. **Communities & directories**: niche directories (Google Maps categories, Doctoralia, iFood/Rappi listings,
   Clutch, Product Hunt), associations, event speaker/exhibitor lists.
7. **Imports**: the human's CSV (`mkt leads import <brand> <file.csv> --source "<where>"`).

Browse with the read-only tools on the brand's account for that platform: `browser_open {account, url}`,
`browser_scroll`, `browser_text`, `browser_snapshot {account, text: true}`. Check the account's limits first:
`policy_status {account}` (heavy browsing on LinkedIn/IG can trigger restrictions — keep sessions short, ≤ 100
profile views/day on LinkedIn, pause if you see warnings, and report).

## Qualification (ICP fit rubric → score 0-100)
| Criterion | Points | Evidence examples |
|---|---|---|
| Persona match (role/business type) | 0-30 | title "owner", "head of ops"; clinic with 3-10 professionals |
| Pain/trigger signal (recent, specific) | 0-25 | posted about no-shows, hiring a receptionist, launching, complaining about tool X |
| Ability to buy (size/budget signals) | 0-20 | team size, locations, pricing page, ad spend visible in ad library |
| Reachability on our channels | 0-15 | active in last 30 days on a platform we have an account on; public business email |
| Warmth | 0-10 | engaged with us / mutual connection / attended event |
Disqualifiers (don't save): competitors, students/job seekers (unless persona), minors, personal accounts with no
business signal, anyone in `suppression_check`, anyone already `do_not_contact`.
≥ 70 = priority, 50-69 = nurture via content, < 50 = don't save.

## Workflow
1. `brand_context {brand, persona}`; read the persona's qualification section; `lead_list {brand, limit: 200}` to know
   who we have (dedupe is automatic on email/phone/handle, but don't waste research time).
2. Collect candidates from the sources above (note the URL where you found each).
3. For each promising candidate: `suppression_check {identifiers: ["<platform>:<handle>", "<email>"]}`; skip if suppressed.
4. Research 2-5 minutes max: find 1-3 **specific personalisation facts** (a recent post, a launch, a hiring post, a
   review they got, a talk they gave). Facts must be public and business-relevant; no personal/family details.
5. Save: `lead_upsert {brand, name, company, role, handles: {<platform>: "<handle or profile url>"}, email?, phone?,
   location, language, persona, score, tags, research: "<1-3 facts with dates>", source: {kind: "<warm|magnet|
   competitor_engager|linkedin_search|hashtag|directory|event|import>", detail: "<what exactly>", url}, stage:
   "researched", consent: {email?, whatsapp?, basis?}, nextActionAt?}`.
   - **consent.email = "legitimate_interest"** only for B2B contacts at a business address where our offer is relevant
     to their role; `basis` = "B2B: <role> at <company>, relevant because <reason>". Consumers → "none".
   - **consent.whatsapp = "opt_in"** only if they gave the number to us for this purpose (form, DM, card at event).
     A number on a website is not opt-in.
   - Emails/phones only from public business sources or given to us; never guess patterns (firstname@) and never buy lists.
6. Tag by batch/source (`tags: ["batch:2026-09-27", "src:linkedin"]`) so outreach and analytics can filter.
7. Report: table (name · company · score · source · 1-line why) sorted by score, count by source, and which
   persona/sources produced the best-fit leads (feeds next run).

## Quality bar
- Every lead has a source URL and at least one specific research fact (priority leads: 2+).
- Score justified by visible evidence, not assumptions.
- No sensitive data (health, religion, politics, sexuality, finances of individuals, minors) — ever.

## Pitfalls
- Scraping hundreds of thin leads: they burn account limits and get ignored. 20 great > 200 vague.
- Counting "liked a post" as a buying signal. Comments with substance and triggers matter.
- Treating public contact info as consent for WhatsApp. It isn't.
- Leaving browser sessions running on LinkedIn for hours (restriction risk).

## Show it
When done, show the batch summary: counts by source, ICP score distribution, top segments. Names, handles and contact details stay local: use `report_open` for a page that lists people, never an Artifact: an Artifact in Claude Code, else `report_open {path}`. See AGENTS.md › Show the result.
