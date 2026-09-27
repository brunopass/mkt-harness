---
name: content-strategy
description: "Plan what to publish, where and why: pillars × personas × funnel matrix, channel roles, cadence per platform, content mix, lead-magnet paths, north-star and leading metrics, and a monthly/weekly calendar in reports/. Use for \"content plan\", \"editorial calendar\", \"social media strategy\", \"plan this week/month\", \"which platforms\". Not for generating individual ideas (idea-engine) or writing scripts (script-writer)."
---

# content-strategy

Decide the system before the posts: who each channel serves, how often, with what mix, and how content turns into
leads. Global rules: [AGENTS.md](../../AGENTS.md).

## Inputs
- `brand`; 90-day goal (from `brand.md` or ask: one number, e.g. "40 qualified leads/month");
  capacity (hours/week and who films/designs); accounts (`account_list {brand}`).

## Workflow
1. `brand_context {brand}` for every persona; read `brand.md` (pillars, lead magnets), `competitors.md`
   (what works in the niche), `trends/radar.md`, latest `reports/week-*.md` (what worked for us).
2. **Funnel map** per persona: tofu = problem-aware attention (broad pains, myths, trends) · mofu = solution-aware
   trust (how-tos, frameworks, case studies, comparisons, objection handling) · bofu = product-aware conversion
   (demos, offers, testimonials with numbers, "is it for you?", FAQs from the inbox).
3. **Matrix** pillars × personas × funnel: for each cell 2-3 angles or "—". Empty bofu cells = revenue leak.
4. **Channel roles** (one sentence each, plus the KPI that proves it works):
   - Reels/TikTok/Shorts: reach + discovery (KPI: non-follower reach, 3s hold, shares).
   - Instagram carousels / LinkedIn documents: saves, authority (KPI: saves/reach, profile visits).
   - LinkedIn text posts: B2B trust + inbound DMs (KPI: comments from ICP, connection requests).
   - X/Threads: conversation, founder voice (KPI: replies, profile clicks).
   - Stories/WhatsApp status/Close friends: bofu nudges to warm audiences (KPI: replies, link taps).
   - Email/newsletter: owned audience, conversion (KPI: reply rate, clicks, booked calls).
   Kill a channel that has no role and no persona there.
5. **Cadence** — sustainable beats heroic. Defaults for a small team (adjust to capacity):
   | Platform | Min viable | Growth mode |
   |---|---|---|
   | Instagram | 3 feed/week (2 reels + 1 carousel) + stories 4 days | 5 feed + daily stories |
   | TikTok | 3/week | 1-2/day |
   | LinkedIn | 2 posts/week (personal profile > page) | 5/week |
   | YouTube Shorts | cross-post reels (native upload) | 5/week |
   | X / Threads | 3/week | daily |
   | Newsletter | 2/month | weekly |
   Stay within the policy's daily post limits per account (`policy_status {account}`).
6. **Mix**: default 70% value (teach/entertain; tofu+mofu) · 20% proof/story (mofu+bofu) · 10% direct offer (bofu).
   Early-stage or launch month → 50/30/20. State the rationale in the plan.
7. **Lead paths**: for each lead magnet in `brand.md` (or propose via the `lead-magnet` skill): which posts feed it,
   the CTA wording per platform ("comenta GUIA", "link na bio", "DM 'checklist'"), and what happens next
   (DM delivery → nurture → offer).
8. **Metrics**: one north star (e.g. qualified leads/week) + 3 leading indicators (e.g. saves/reach on carousels,
   comment-keyword DMs, reply rate on outreach). Baseline from `reports/` or "unknown — measure week 1".
9. **Calendar**: write `reports/plan-YYYY-MM.md` (month) and/or `reports/week-YYYY-MM-DD-plan.md`:
   | Date | Platform(s) | Pillar | Persona | Funnel | Format | Working title | Trend? | Owner | Content id |
   Leave `Content id` for idea-engine to fill; or run idea-engine right after and link ids.
10. Report: the plan in 10 lines, capacity assumptions, and what to cut first if capacity drops.

## Quality bar
- Every calendar row has a persona and a funnel stage; each week has ≥ 1 bofu piece.
- Every channel has a role, a KPI and an owner; no platform "because everyone is there".
- Plan fits stated capacity (count production hours: reel ~1.5h, carousel ~1h, text post ~20min).
- Languages: separate rows per language when the brand posts in several; not auto-translations.

## Pitfalls
- Planning 30 posts nobody can produce. Under-promise; consistency compounds.
- All tofu (vanity reach, no leads) or all bofu (ad fatigue, unfollows).
- Ignoring what already worked: reuse winning formats before inventing new ones.
- Treating brand accounts on different platforms as mirrors — see `repurpose`.
