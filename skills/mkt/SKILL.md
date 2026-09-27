---
name: mkt
description: "Home of the mkt-harness: where a brand stands and the next best actions, then do the one the human picks. Use when a session starts with /mkt (setup and `mkt open` start here), or when the human asks \"where are we\", \"status\", \"what's next\", \"what should I do today\", or opens the harness without a task. Not for a task the human already named: go straight to that skill."
---

# mkt: home

The first screen of every session: show the state of the brand in a few lines, recommend what to do next, and start
on it. Rules: [AGENTS.md](../../AGENTS.md). Everything here is read-only until the human picks an action.

## 1. Pick the brand
- The argument (`/mkt acme`) if given. Otherwise `brand_list`: ignore `example`; if there is exactly one other brand
  use it; if there are several, ask which (one line, numbered); if there are none, tell the human to run `mkt` in a
  terminal to set one up, and stop.

## 2. Read the state (all read-only, in parallel where you can)
- `brand_get {brand}` → config, accounts, personas.
- Foundation: read `brand.md`, `voice.md`, `offers.md`, `personas/*.md`. A file still containing the template's
  `<!-- ... -->` placeholders counts as **not filled**. Count the lines under `## Open questions` in `brand.md`.
- Research: list `workspace/brands/<brand>/research/` (site scans: the brand's own host and competitors). Look at the
  newest `workspace/runs/*-research-<brand>.json`: finished (has `output`) or none. A `workspace/logs/research-<brand>-*.log`
  newer than any run file means a background research run may still be going.
- Queue: `outbox_list {brand, status: ["pending_approval"]}`, and `["failed","blocked"]`.
- Conversations: `conversation_list {brand, needsReply: true}`.
- Leads: `lead_list {brand, dueBefore: <now ISO>}` and the total count by stage (`lead_list {brand}`).
- Content: `content_list {brand}`: counts by status; anything scheduled in the next 7 days.
- Trends: `trend_momentum {brand, limit: 3}` (skip if empty); `trends/radar.md` last-modified if it exists.

## 3. Show the dashboard (max ~15 lines, the human's language)
```
<Brand name> (<slug>) · <languages> · <n> accounts
Foundation   brand ✓ · voice ✗ · offers ✓ · personas 1 · 5 open questions
Research     site + 4 competitor scans · deep research finished 2h ago
Queue        3 waiting for approval (run `mkt review`) · 1 failed
Inbox        2 threads need a reply
Leads        14 total · 3 follow-ups due
Content      6 ideas · 2 drafts · 1 scheduled this week
Trends       "ia para restaurantes" rising (+34%/wk)
```
Leave out lines with nothing to say. Never paste file contents here.

## 4. Recommend the next 3 actions, best first
Pick from this ladder, top-down, skipping what's done:
1. A background research run is still going → say so; offer something that doesn't touch the brand files meanwhile.
2. Foundation not filled and no research finished → **Build the foundation** (`brand-foundation`: reads the site, asks
   up to 8 questions).
3. Open questions in `brand.md` → **Answer N open questions** (~5 min): ask them one at a time, write each answer into
   the right file, remove the question when settled.
4. Items failed/blocked in the outbox → **Fix N items** (explain each `lastError`).
5. Items waiting for approval → tell the human to run `mkt review` in a terminal (you can't approve).
6. Threads needing a reply → **Answer the inbox** (`inbox`).
7. Leads with follow-ups due → **Draft follow-ups** (`outreach`).
8. No personas beyond the placeholder → **Understand the customer** (`customer-research`).
9. Fewer than 3 ideas/drafts for the coming week → **Plan the week** (`trend-radar` if the radar is older than 7
   days, then `idea-engine` and `script-writer`).
10. No leads yet → **Find the first 20 leads** (`lead-gen`).
Each recommendation: one line with what it is, why now (the number from the dashboard), and roughly how long.

## 5. Ask, then do
End with the numbered list and a question like "Which one? (or tell me something else)". When the human picks, load
that skill and follow it. Don't start work before they pick, except when the brand has nothing at all yet: then start
the foundation directly.

## Pitfalls
- Don't run `inbox_sync`, scans or research here: this screen must be quick and free.
- Don't list tools or explain the harness unless asked; show state and actions.
- If a tool is denied, say which and why it matters (e.g. "WebSearch is blocked in this session: accept the folder
  trust prompt, or run Claude from `mkt open`"), then continue with what works.
