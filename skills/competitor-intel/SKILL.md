---
name: competitor-intel
description: "Analyse competitors and alternatives: positioning, pricing, offers, which channels and content formats work for them, top hooks, ads they run, and the gaps we can own; writes competitors.md. Use for \"analyse competitors\", \"what is X posting\", \"competitor content audit\", \"ad library research\", \"find gaps\". Not for customer VoC (customer-research) or daily trend tracking (trend-radar)."
---

# competitor-intel

Know what the alternatives say, what works for them, and where they leave room for us.
Global rules: [AGENTS.md](../../AGENTS.md). Research is read-only: never follow, like, comment or DM from a brand
account while researching.

## Inputs
- `brand`; competitor list from `brand.md` (Unlike…), `competitors.md`, customer-research ("we already use X"),
  or ask for 3-6 names. Include 1-2 indirect alternatives (spreadsheet, agency, freelancer, doing nothing).

## Workflow
1. `brand_context {brand}`; read `competitors.md` and `insight_list {brand, kind: ["competitor"]}`.
2. **Website pass**: `site_scan {url, brand}` gives a structured first read (positioning line, languages, socials,
   contacts, look) saved to `research/<host>.md`; then WebFetch for depth: home headline + subhead, category they claim, pricing page (tiers, anchor price,
   free trial/freemium, annual discount), guarantee, main CTA, proof they show. Capture the headline verbatim.
3. **Social pass** (browser, read-only, on a logged-in brand account of the same platform):
   `browser_open {account, url: "<competitor profile>"}`, `browser_scroll`, `browser_text`, `browser_screenshot`
   when a visual pattern matters. For each platform they're active on, record for the last 30 posts:
   format (reel/carousel/text/video), hook (first line / first 2s on-screen text), topic/pillar, CTA, and visible
   engagement (views/likes/comments). Rank by engagement relative to their follower count; study the top 5 and the
   bottom 5 (what to avoid).
4. **Ads**: Meta Ad Library (`https://www.facebook.com/ads/library/` — country + name), TikTok Creative Center
   (Top Ads, filter by industry/region), LinkedIn company page → "Ads" tab / LinkedIn Ad Library, Google Ads
   Transparency Center. Long-running ads (> 30 days) are the ones that convert — note their angle, offer and format.
5. **Customers' view**: 3★ reviews of each competitor (what they fail at) → `insight_add` with `kind: "competitor"`
   and verbatim quotes.
6. **Synthesis** → write `workspace/brands/<brand>/competitors.md`:
   - Table (template columns): Competitor | Positioning (their headline) | Price | Channels that work |
     Top formats/hooks | Gaps we can own.
   - Per competitor: 3-5 bullet teardown; top 3 posts with URL + why it worked (hook type, emotion, format, timing).
   - **Pattern section**: hooks/formats that work across ≥ 2 competitors (table stakes), and angles nobody takes.
   - **Gaps**: underserved persona, unanswered objection, unowned format (e.g. nobody does founder-led video in pt-BR),
     price/packaging gap, channel gap. Each gap → one concrete content or offer idea.
7. Optionally create 3-5 `content_create {brand, title, status: "idea", hook, pillar, persona, body}` ideas from the
   gaps (idea-engine will score them).
8. Report the 5 most important findings, each with evidence.

## Metrics discipline
- Engagement rate proxy = (likes + comments) / followers, or views / followers for video. Note the date seen.
- Don't compare raw numbers across platforms. Compare within a platform and time window.
- Numbers you couldn't see → leave blank, don't estimate.

## Quality bar
- Every claim about a competitor links to where you saw it (URL + date).
- At least 3 gaps, each tied to evidence (a review, a missing format, an unanswered objection).
- Clear "steal / avoid / own" recommendation per pattern.

## Pitfalls
- Copying competitor hooks word-for-word: extract the structure, rewrite in our voice with our proof.
- Assuming high follower count = what works now. Look at recent posts and long-running ads.
- Logging into or interacting from the brand account (visible to them, and can look like spam).

## Show it
When done, show `competitors.md` as a comparison page (positioning, pricing, channels, gaps): an Artifact in Claude Code, else `report_open {path}`. See AGENTS.md › Show the result.
