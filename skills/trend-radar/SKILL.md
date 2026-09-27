---
name: trend-radar
description: "Follow and forecast trends for a brand: collect measured signals (Google Trends, TikTok Creative Center, YouTube, X, Reddit, RSS, competitors), record them as time series, read momentum/forecast, decide ride/watch/skip with a timing window, update trends/radar.md and seed ideas. Use for \"what's trending\", \"trend report\", \"forecast trends\", \"daily/weekly radar\", scheduled trend routines. Not for evergreen content planning (content-strategy) or competitor teardown (competitor-intel)."
---

# trend-radar

Measure attention over time, not vibes. A trend is a series of observations; the harness fits the growth, you
judge brand fit and timing. Global rules: [AGENTS.md](../../AGENTS.md).

## Inputs
- `brand`; markets = `brand.yaml languages` + countries (ask if unclear: BR, ES, MX, US…); pillars and personas.
- Previous radar: `workspace/brands/<brand>/trends/radar.md`.

## Measurement discipline (this is what makes forecasting work)
- **Topic**: lowercase, canonical, no emojis — `"ai receptionist"`, `"morango do amor"`, `"#booktok"`. Reuse the exact
  topic string every time (check `trend_momentum {brand}` output for existing names before inventing a new one).
- **Source**: fixed vocabulary — `google_trends_<GEO>`, `tiktok_cc_<GEO>`, `youtube_search`, `x_explore_<GEO>`,
  `reddit_<subreddit>`, `rss_<site>`, `ig_hashtag`, `competitor_<name>`.
- **Metric**: what you actually read — `approx_traffic`, `views`, `posts`, `videos`, `search_interest` (0-100),
  `rank` (lower = better; the math inverts it), `mentions`, `upvotes`.
- Record **only numbers you saw**, with `url`. Unknown → don't record. Same topic+source+metric measured on ≥ 3 days
  is what turns a "new_signal" into a forecast.

## Workflow
1. `brand_context {brand}`; read `trends/radar.md`; `trend_momentum {brand, windowDays: 30}` for the current board.
2. **Collect** (15-40 min budget; breadth > depth):
   - `trend_fetch_feed {brand, feed: "google-trends:<GEO>"}` for each market (auto-records `approx_traffic`).
   - Industry RSS: `trend_fetch_feed {brand, feed: "https://…/feed"}` (headlines only; record `mentions` yourself if a
     topic repeats across sources).
   - TikTok Creative Center (`https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en`,
     songs, creators; filter region + industry + 7 days): read rank/posts/views via `browser_open` + `browser_text`.
   - YouTube search (filter: this week, sort by view count) for 3-5 pillar keywords: top-10 view counts.
   - X Explore / Trending (logged-in brand account), Reddit `top?t=week` of 2-4 niche subreddits (upvotes/comments).
   - Competitors' last week: formats or sounds suddenly used by ≥ 2 of them (`competitor_<name>`, metric `posts`).
3. **Record** in one or few calls: `trend_observe {brand, observations: [{topic, source, metric, value, url, note}]}`.
4. **Read momentum**: `trend_momentum {brand, windowDays: 30, limit: 30}`. Per topic you get `momentum` (weekly
   growth, e.g. 0.4 = +40%/week), `confidence` (0-1; fit quality × data points × breadth of sources), `stage`, and per
   series `forecast7d`.
   | stage | meaning | default move |
   |---|---|---|
   | new_signal | < 2 points / < 12h span | watch; measure again tomorrow |
   | surging | > +50%/week | ride now if fit ≥ 4 (window: days) |
   | rising | +10…+50%/week | plan content this week (window: 1-3 weeks) |
   | steady | ±10% | evergreen angle only |
   | peaking | was rising, now > 15% below max | only if you can publish within 48h; else skip |
   | fading | < −10%/week | skip (or "RIP X" retrospective if very on-brand) |
   Confidence < 0.3 = one noisy source: treat as watch, however big the number.
5. **Brand fit (1-5)** per candidate: persona cares? · can we say something true and useful? · pillar match ·
   no brand-safety risk (tragedy, politics, polarising memes) · we can produce it inside the window.
   Decision = **ride** (fit ≥ 4 and stage surging/rising, confidence ≥ 0.3) · **watch** · **skip**, with a reason.
6. **Write `trends/radar.md`** using `references/radar-template.md` (overwrite the "Current" section; append the old
   "Current" summary under "History" as one dated line per ridden trend).
7. **Seed ideas** for each "ride": `content_create {brand, title, status: "idea", format, pillar, persona, trend:
   "<topic>", hook, platforms, language, body: "## Brief\n- Angle…\n- Window: publish by <date>…"}`. Max 3 per run.
8. Summary: top movers, rides with deadline, anything peaking that we're missing.

## Forecasting heuristics
- Search leads social for utility topics (people search before they post); social leads search for memes/formats.
- Cross-platform confirmation (`sources ≥ 2`) roughly doubles the useful life of a trend.
- Formats/sounds on TikTok typically run 2-4 weeks from first spike; news-driven spikes 24-72h.
- Seasonal: check the same week last year (Google Trends explore, 5-year view) before calling something new.

## Quality bar
- Every observation has a real number and URL; topic names consistent with previous runs.
- Each "ride" has a publish-by date, an angle tied to a pillar, and a persona.
- Skips have one-line reasons (helps next week's run not re-evaluate from scratch).

## Pitfalls
- Recording estimates or "high/medium" as numbers. Don't.
- Jumping on tragedies, politics or other brands' crises. Skip unless the brand is genuinely part of the story.
- Renaming topics between runs (`"ai agents"` vs `"ai agent"`) — kills the time series.
- Treating Google Trends daily RSS as niche signal: it's mass-market; use it for timing/cultural moments.
