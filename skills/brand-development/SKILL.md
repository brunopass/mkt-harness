---
name: brand-development
description: "Evolve a brand from evidence: propose positioning, messaging, voice, offer framing, taglines/naming and visual notes changes based on insights, win/loss, conversations and content performance; design message tests via content variants; changes are proposed as a dated changelog + diff for human sign-off. Use for \"refine positioning\", \"our messaging isn't landing\", \"test messages\", \"new tagline\", \"rebrand ideas\", quarterly brand review. Not for initial setup (brand-foundation)."
---

# brand-development

Brands drift toward what customers respond to — deliberately, with evidence, and with the founder's sign-off.
Global rules: [AGENTS.md](../../AGENTS.md). You **propose**; you never silently rewrite positioning, voice or offers.
In autopilot you may apply voice and messaging changes backed by evidence (status: applied, with the diff kept in the
changelog and a line in `reports/decisions.md`); positioning, offers and prices stay proposals for a human.

## Inputs
- `brand`; the trigger (quarterly review, a new persona emerging, low conversion, a launch, a competitor move);
  time window (default last 90 days).

## Evidence to gather
- `insight_list {brand, limit: 200}` — recurring pains/desires/objections; language shifts; competitor mentions.
- Win/loss: `lead_list {brand, stage: ["customer"]}` and `{stage: ["lost"]}` → `lead_get` for notes/threads: why
  they bought, why they didn't (their words).
- `conversation_list {brand, limit: 200}` → the questions people ask before buying (what the site fails to answer).
- `reports/week-*.md` → which messages/hooks/pillars perform and convert (not just reach).
- `competitors.md`, `trends/radar.md` → category shifts, new alternatives.
- Current `brand.md`, `voice.md`, `offers.md`, personas.

## Workflow
1. Gather evidence; build a table: signal · evidence (ids/quotes/numbers) · strength (1-5) · implication.
2. **Diagnose** with these questions:
   - Is the best-fit customer still the one in `brand.md`? (Who converts fastest/retains best?)
   - Do customers describe the value in different words than we do? (Language bank vs our headline.)
   - Which alternative do we actually lose to? Is the "Unlike" line still true?
   - Which proof points appear in wins? Which objections kill deals?
   - Does the voice fit where we're winning (e.g. LinkedIn founders vs TikTok consumers)?
3. **Propose** 1-3 changes max per cycle, each: what changes · why (evidence) · risk · how we'll test it · success
   metric. Types: positioning line, primary message, supporting message swap, new proof point, persona priority,
   offer framing/packaging (price changes are the founder's call — frame as questions), voice rule, pillar
   add/drop, tagline/naming options, visual notes.
4. **Message tests** before committing: create 2-3 content variants that differ only in the message (same format,
   similar slot): `content_create {brand, title: "<test>: variant A", status: "idea", pillar, persona, hook, body:
   "## Brief\n- Message test: <hypothesis>…"}`. Define the winning metric up front (e.g. qualified DMs/1k reach, save
   rate, reply rate in outreach openers). Outreach openers can A/B too (two `sequence.name`s).
5. **Taglines/naming** (when asked): 10-20 options across styles (descriptive, benefit, provocative, coined), check
   each for clarity in every brand language, trademark/SEO collision (WebSearch), domain/handle availability (flag, don't
   claim), negative meanings in pt/es/en slang. Shortlist 3 with rationale.
6. **Write the proposal** — append to `brand.md` (and `voice.md` if relevant) a section:
   ```
   ## Proposed changes — YYYY-MM-DD (status: proposed)
   ### 1. <change>
   - Evidence: …
   - Before: "<current text>"
   - After:  "<proposed text>"
   - Test: <content ids / sequence> · metric · decision date
   ```
   Keep the current sections untouched until the human approves. On approval (the human says so), apply the diff,
   change the section status to `accepted YYYY-MM-DD`, and keep it as the changelog.
7. Report: the 1-3 proposals, evidence strength, tests queued, decision date.

## Visual notes
Only propose visual changes with a reason (legibility on mobile, consistency across carousels, contrast failures,
category conventions to break or follow). Colour changes → update `brand.yaml visual` only after approval; re-render
a sample carousel (`content_render`) for the human to compare.

## Quality bar
- Every proposal cites evidence strength ≥ 3 or is explicitly labelled a hypothesis to test.
- Before/after text is exact, so the human can approve line by line.
- Tests have a metric and a decision date.

## Pitfalls
- Rebranding because the team is bored. Customers barely noticed the old one.
- Chasing one viral post's angle into the positioning.
- Changing voice per trend. Voice evolves slowly; formats can change fast.
