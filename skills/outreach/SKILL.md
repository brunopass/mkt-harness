---
name: outreach
description: "Write and queue personalised outreach and follow-up sequences (LinkedIn connect notes and DMs, Instagram/X DMs, cold email, WhatsApp to opted-in contacts) into the outbox for approval, and keep leads' next actions current. Use for \"reach out to these leads\", \"write a sequence\", \"follow up\", \"cold email\", \"DM campaign\", scheduled follow-up routines. Not for answering people who wrote to us (inbox), finding leads (lead-gen) or posting content (publish)."
---

# outreach

Relevant, honest, short, and easy to say no to. Every message is drafted into the outbox; a human approves.
Global rules: [AGENTS.md](../../AGENTS.md). Templates: [references/templates.md](references/templates.md).

## Inputs
- `brand`; leads (ids, or a filter like `lead_list {brand, stage: ["researched"], minScore: 70}`); the offer or
  conversation goal (usually a short call or a lead magnet, not a sale); sending accounts (`account_list {brand}`).

## Personalisation formula (every first touch)
**Observation → relevance → low-friction ask.**
1. Observation: one specific, verifiable thing about them (from `research`): "Vi que vocês abriram a segunda unidade
   em Pinheiros". Not "I love your content".
2. Relevance: why that makes our topic useful to them now, in one sentence, with a proof point if we have one.
3. Ask: a yes/no or "worth a look?" question, or an offer of something free (the lead magnet). No calendar link in
   touch 1 of cold outreach.
Length: LinkedIn connect note ≤ 300 chars (aim 200); DM 40-90 words; cold email 50-125 words; WhatsApp 1-3 short lines.

## Sequence design (default "4 touches / ~12 days")
| Step | Day | Channel | Content |
|---|---|---|---|
| 1 | 0 | primary (LinkedIn connect / IG DM / email) | observation → relevance → ask |
| 2 | 3-4 | same thread | add value: a resource, a 2-line insight, a relevant case (no "just bumping this") |
| 3 | 7-8 | second channel if we have consent/presence (email ↔ LinkedIn) | different angle: objection-preempt or peer proof |
| 4 | 12-14 | same thread | breakup: "Should I close the loop? If timing's off, no worries." |
The policy enforces spacing (`outreach.minHoursBetweenTouches`), max touches without reply, quiet hours, suppression,
consent and daily limits; deferred items simply wait. On any reply or opt-out, queued items for that lead are
cancelled automatically — the conversation moves to the `inbox` skill.

## Workflow
1. `brand_context {brand, persona}`; `insight_list {brand, persona, kind: ["objection","language"]}` for their words.
2. Select leads: `lead_list {brand, stage: ["researched","contacted"], minScore: 60}` or `dueBefore: <now>` for
   follow-ups. For each: `lead_get {brand, id}` → research, threads, previous outbox items (never repeat a line).
3. Check channel eligibility per lead:
   - Email: needs `consent.email` ≠ "none" and a business email; subject rules below.
   - WhatsApp: only `consent.whatsapp = "opt_in"` or they messaged us first.
   - LinkedIn/IG/X DM: public business context; LinkedIn cold DMs usually need a connection first → `kind: "connect"`
     with a note, then DM after acceptance.
   - `policy_status {account}` for remaining quota; plan the batch within it.
4. Write each message natively in the lead's language (`lead.language`, else the brand's primary). Personalise
   step 1 fully; later steps reference the earlier touch and add something new.
5. Queue: `outbox_draft {brand, kind: "connect"|"dm"|"email", account, to: {leadId}, subject?, body, rationale:
   "<why this lead, why now, which fact>", sequence: {name: "<campaign-slug>", step: n}, scheduledFor?}`.
   Draft **only the next step** per lead (later steps depend on what happens). Space the batch: set `scheduledFor`
   across the sending window rather than all at once.
6. Update each lead: `lead_update {brand, id, nextActionAt: "<when to check for step n+1>", note: "step n queued"}`.
7. Report: count queued per account/step, anything blocked (suppressed, no consent, max touches), and remind the human:
   `mkt review`.

## Cold email rules
- Subject: 2-6 words, lowercase-ish, specific, honest (“segunda unidade + agenda”, “pergunta sobre no-shows”).
  Never "Re:"/"Fwd:" on a first email, no fake urgency, no clickbait.
- From a real person at the brand; signature with name, role, company. The harness appends the opt-out line and
  sender address on cold `email` automatically.
- Plain text, no images/attachments, ≤ 1 link (none in email 1 ideally).

## Tone rules
- Honest identity and intent. No fake familiarity ("as we discussed", "loved meeting you"), no pretending to be a
  customer, no invented mutual connections, no "quick question" that's actually a pitch.
- Reference public, business-relevant facts only; nothing that feels like surveillance ("saw your kid's birthday").
- One ask per message. Make "no" easy.

## Quality bar
- Every step-1 message contains a fact only true for that lead. Swap the name → it should no longer make sense.
- Rationale explains the choice in one sentence the reviewer can check.
- Within limits and consent; no duplicate lines across touches.

## Pitfalls
- Sending the whole sequence up-front. Queue one step at a time.
- Pitching the product in a connection note.
- Ignoring language/region (pt-BR vs pt-PT, es-ES vs es-MX formality).
- Retrying blocked items by rephrasing to dodge the policy. Blocked = stop and report.
