---
name: idea-engine
description: "Generate, dedupe and score content ideas from research, trends, the inbox and the plan, then save the best as content items with scores. Use for \"give me ideas\", \"fill the calendar\", \"brainstorm posts\", \"what should we post\", \"ideas from trends/FAQs\". Not for writing the full script/caption (script-writer) or the overall plan (content-strategy)."
---

# idea-engine

Many ideas in, few scored ideas out. Every idea is grounded in a real pain, question, trend or proof point.
Global rules: [AGENTS.md](../../AGENTS.md).

## Inputs
- `brand`; target count (default 10 saved, from ~30 generated); optional persona, pillar, funnel stage, platform,
  language, or a calendar file in `reports/` to fill.

## Raw material (pull before generating)
- `brand_context {brand, persona}` (pillars, offers, proof, persona pains, language bank).
- `insight_list {brand, persona, kind: ["pain","objection","question","desire","trigger"], limit: 60}`.
- `conversation_list {brand, limit: 50}` → questions customers asked this week (FAQ goldmine).
- `trend_momentum {brand, limit: 20}` and `trends/radar.md` "Ride" rows.
- `content_list {brand}` → existing titles/hooks to avoid duplicates; `reports/week-*.md` for what performed.

## Generation methods (use at least 6 per batch)
| Method | Formula | Example (pt-BR / es / en) |
|---|---|---|
| Pain → promise | "<pain in their words>? <result> without <sacrifice>" | "Agenda cheia de faltas? Como cortar no-show pela metade sem ligar pra ninguém" |
| Myth-bust | "<common belief> is wrong. Here's why" | "Publicar todo dia no es lo que te hace crecer" |
| Contrarian | "Unpopular opinion: <take backed by proof>" | "Unpopular opinion: your website doesn't need a chatbot" |
| Story | "<Customer/founder> was <situation>. Then <turn>" | "A Ana perdia 6h por semana em planilha. Até que…" |
| Case study | "<Result with number> in <time>: exactly what we did" | "+38% de reservas em 60 dias: o passo a passo" |
| How-to | "How to <outcome> in <n> steps (<constraint>)" | "Cómo responder 100 DMs al día sin contratar" |
| List | "<n> <things> that <outcome/cost>" | "7 erros que fazem seu cliente sumir depois do orçamento" |
| Before/after | "Before: <state>. After: <state>. The difference: <mechanism>" | visual split-screen |
| Trend-jack | "<trend/format> but for <niche>" | "Morango do amor, mas é seu funil de vendas" |
| Objection handling | "'<objection verbatim>'. Fair. Here's the real answer" | "'É caro.' Vamos fazer a conta." |
| Behind the scenes | "What <doing X> actually looks like" | day in the life, tool stack, mistakes |
| FAQ from inbox | the exact question a customer asked this week, answered in 30s | "Funciona com WhatsApp Business?" |
| Comparison | "<A> vs <B>: which one for <persona>?" | honest, including when not us |
| Checklist/template | "Steal my <template> for <task>" | lead-magnet feeder (comment keyword) |

## Scoring rubric (1-5 each)
| Key | Weight | 5 means |
|---|---|---|
| `hook` | 20 | first line/2s stops the scroll for this persona; specific, tension or curiosity |
| `fit` | 25 | a top-3 pain/objection of the persona, on a pillar, on-brand |
| `lead` | 20 | natural CTA into a lead magnet/offer; bofu/mofu intent |
| `trend` | 10 | rides a rising/surging trend (radar), else 1-2 for evergreen |
| `proof` | 15 | we have real proof/examples to back it (proof bank, case, data) |
| `effort` | 10 | 5 = cheap to produce (text/carousel), 1 = shoot + edit heavy |
Score (0-100) = Σ weight × (s − 1) / 4 (weights sum to 100). If `reports/scoring-weights.md` exists (written by
`analytics-review` from real results), use its weights instead and say so in the report.

## Workflow
1. Pull the raw material above. List ~30 raw ideas quickly (one line each: method · persona · angle · hook).
2. **Dedupe**: drop ideas whose angle matches an existing `content_list` title/hook, unless it's a deliberate
   re-run of a winner (then say "re-run of c_xxx with new hook").
3. Score each; keep the top N (default 10) with a spread: ≥ 1 bofu, ≥ 2 formats, ≥ 2 pillars.
4. Save each: `content_create {brand, title, status: "idea", format, pillar, persona, funnel, platforms, language,
   hook, cta, leadMagnet?, trend?, score, scores: {hook, fit, lead, trend, proof, effort}, body}` with body:
   ```
   ## Brief
   - Persona / pain: <persona> — "<verbatim quote>" (insight source)
   - Promise (one line):
   - Proof: <from proof bank, or "NEEDS PROOF">
   - Angle / method:
   - CTA: <comment keyword / link / DM>
   - Why now: <trend + window, or evergreen>
   ```
5. If filling a calendar, write the ids back into the plan file's `Content id` column.
6. Report a ranked table: score · title · format · persona · funnel · why it should work.

## Quality bar
- Each saved idea cites its raw material (quote, trend, FAQ, proof).
- Hooks are specific (numbers, names of situations, their words), no "Did you know…?" filler.
- Language: ideas for pt-BR audiences written in pt-BR from scratch (idioms, references), not translated.

## Pitfalls
- 10 variations of one idea. Spread methods and personas.
- Scoring everything 4-5. Force-rank; a 60 is a fine idea, 80+ should be rare.
- Ideas needing proof we don't have: keep them but mark `NEEDS PROOF` and score `proof` 1.

## Show it
When done, show the scored ideas (a ranked table with the scores that drove them): an Artifact in Claude Code, else `report_open {path}`. See AGENTS.md › Show the result.
