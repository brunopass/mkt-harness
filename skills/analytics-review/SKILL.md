---
name: analytics-review
description: "Measure what happened and feed it back: collect metrics for published content, analyse by pillar/format/hook/persona/time, attribute leads and conversations to content and outreach, write the weekly report (3 learnings, 3 actions) and update scoring weights and brand do/don'ts. Use for \"weekly report\", \"what worked\", \"analyse performance\", \"metrics\", \"which posts brought leads\", scheduled weekly routines. Not for competitor numbers (competitor-intel) or trend data (trend-radar)."
---

# analytics-review

Close the loop: numbers in, decisions out. Global rules: [AGENTS.md](../../AGENTS.md). Record only numbers you
actually read; blanks beat guesses.

## Inputs
- `brand`, period (default: last 7 days ending yesterday), previous report `reports/week-*.md`.

## Metric vocabulary (use these keys in `content_update {metrics}`)
`impressions, reach, views, plays_3s, avg_watch_s, completion_rate, likes, comments, shares, saves, profile_visits,
follows, link_clicks, dms, keyword_comments, leads` (+ `replies`, `reposts` for X/Threads).
Derived (compute in the report, don't store): engagement rate = (likes+comments+shares+saves)/reach ·
save rate = saves/reach · share rate = shares/reach · hold rate = plays_3s/views · leads per 1k reach.

## Workflow
1. **Published items**: `content_list {brand, status: ["published"]}` → for each item in the period
   `content_get {brand, id}` → `published[]` has account + url + time.
2. **Collect metrics** per url/account (48h+ after posting for stable numbers; re-collect at day 7 for reels/TikTok):
   - Browser (read-only) on the brand account: IG post/reel "View insights", TikTok Studio analytics, LinkedIn
     post analytics, YouTube Studio, X post analytics → `browser_open {account, url}` + `browser_text {account}`
     (+ `browser_screenshot` when numbers are in charts).
   - Or the human's CSV export dropped in `reports/raw/` (read it).
   - Save: `content_update {brand, id, metrics: {views: 12400, saves: 310, …}}` (merge per platform in the body
     under `## Results` via `appendBody` when an item ran on several accounts: one line per account).
3. **Leads & conversations**:
   - `lead_list {brand, limit: 500}` → leads created in the period; group by `source.kind` and tags
     (`magnet:<slug>`, `batch:<date>`, `src:<source>`). Content-driven leads should carry `source: {kind:
     "content", detail: "<content id>"}` or tag `content:<id>` — fix missing attribution where the thread makes it
     obvious (`lead_update`).
   - `conversation_list {brand, limit: 200}` → inbound threads started in the period, by platform.
   - `outbox_list {brand, status: ["sent"]}` → outreach sent by sequence/step; reply rate = leads moved to
     replied/qualified ÷ leads contacted. Funnel: contacted → replied → qualified → meeting → customer.
4. **Analyse** (small numbers → look for big differences, not decimals):
   - By format, pillar, persona, funnel stage, hook method (from the idea's brief), language, posting slot.
   - Top 3 and bottom 3 items with a one-line hypothesis each ("hook named a specific pain → 2× hold rate").
   - Outreach: reply rate by sequence step, channel, persona; best-performing opening line.
   - Leads: which content/sources produced qualified leads (not just leads).
5. **Write `reports/week-YYYY-MM-DD.md`** (date = Monday of the reviewed week):
   ```
   # Week of YYYY-MM-DD — <brand>
   ## Scoreboard (vs last week)       north star + 3 leading metrics, ▲/▼
   ## Content                         table: id · title · format · platform · reach · ER · saves · leads
   ## Outreach & inbox                sent, replies, reply rate, qualified, meetings; inbox volume + response time
   ## Leads                           new by source; qualified by source
   ## 3 learnings                     each with evidence (numbers + ids)
   ## 3 actions for next week         each concrete, owned, measurable
   ## Changes made                    scoring weights, voice/brand do-don't, cadence
   ```
6. **Feed back**:
   - Idea scoring: if a dimension predicted results (e.g. `trend` ideas underperform), write the new weights to
     `reports/scoring-weights.md` (a table `key | weight | why | since`) and list the change under "Changes made".
     idea-engine reads that file before scoring.
   - Add proven patterns to `brand.md → Do / Don't` (with the evidence id); personas' "where they hang out" if a
     platform clearly over-delivers for one persona.
   - Winners → `repurpose` candidates; losers with good ideas → new hook and re-run.
7. Summary back to the human: scoreboard + learnings + actions in ≤ 12 lines.

## Quality bar
- Every learning cites numbers and item ids; every action is specific ("post 2 carousels on objection X on Tue/Thu").
- Metrics labelled with collection date; partial data flagged.
- Leads counted by qualified, not raw.

## Pitfalls
- Judging reels at hour 3. Wait 48h; re-check at day 7.
- Comparing reach across platforms or across accounts of very different size.
- Declaring a winner from one post. Look for patterns across ≥ 3 items.
- Vanity focus: a post with half the reach and 5 qualified DMs beats a viral post with none.
