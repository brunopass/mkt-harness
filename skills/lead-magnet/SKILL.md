---
name: lead-magnet
description: "Design lead magnets and the conversion path around them: pick the type, write the asset outline, the keyword-comment → DM funnel (\"comenta GUIA\"), delivery messages (only to people who asked), nurture follow-up and landing-page copy. Use for \"create a lead magnet\", \"comment to get funnel\", \"freebie\", \"isca digital\", \"checklist/template to capture leads\", \"deliver the guide to commenters\". Not for cold prospecting (lead-gen/outreach)."
---

# lead-magnet

Trade something genuinely useful for a clear, consented next step. Global rules: [AGENTS.md](../../AGENTS.md).

## Inputs
- `brand`, persona, the offer it should lead to (`offers.md`), the channel mix, languages.

## Choosing the magnet
Good magnets solve one narrow, urgent problem fast (< 15 min to value) and naturally lead to the paid offer.
| Type | Best for | Effort | Example |
|---|---|---|---|
| Checklist | ops/process pains | low | "Checklist anti no-show (12 itens)" |
| Template/swipe file | "how do I write/set up X" | low | "5 mensagens de follow-up que funcionam" |
| Calculator/spreadsheet | ROI/price objections | med | "Calculadora de faturamento perdido" |
| Mini-course (3-5 DMs/emails) | education-heavy offers | med | "3 días para ordenar tu agenda" |
| Audit/teardown (1:1) | high-ticket B2B | high per lead | "I'll review your Instagram bio in a DM" |
| Quiz/diagnostic | segmentation | med | "What's your lead-response score?" |
| Case study PDF | bofu proof | low | "How clinic X added 40 bookings" |
Pick with: pain weight (insights) × link to offer × production effort. One magnet per persona is enough to start.

## Workflow
1. `brand_context {brand, persona}`; `insight_list {brand, persona, kind: ["pain","question","objection"]}`; read
   `brand.md → Lead magnets & conversion paths`.
2. Propose 3 magnet options with the table columns above + the offer it leads to; pick one (or ask the human).
3. **Outline the asset** in `reports/lead-magnet-<slug>.md`: title (outcome-based, specific), promise, table of
   contents, each section's key point, the bridge to the offer on the last page. The human (or a design tool)
   produces the final file; store it under `workspace/brands/<brand>/assets/magnets/` and the public URL in `brand.md`.
4. **Keyword funnel** (Instagram/TikTok/LinkedIn):
   - Keyword: one word, easy in the language (GUIA, CHECKLIST, PLANILLA, TEMPLATE); unique per magnet.
   - Content: 2-4 posts (carousel + reel + story) with CTA "Comenta <KEYWORD> que eu te mando". Create them via
     idea-engine/script-writer with `leadMagnet: "<slug>"` in the content item.
   - Public reply to each comment (short, varied: "Enviado! 📩", "Te mandei na DM") — as `outbox_draft kind:"comment"`
     with `to.url` = the post URL. Vary wording; identical replies at volume look automated.
5. **Delivery** — only to people who asked (the comment/DM request is consent for that single delivery):
   - Log the request: `conversation_log {brand, account, messages: [{direction: "in", text: "comment: GUIA", contact:
     {handle}, url: <post url>}]}`.
   - Upsert the lead: `lead_upsert {brand, handles: {<platform>: handle}, source: {kind: "lead_magnet", detail:
     "<slug> via comment", url}, persona, stage: "new", consent: {basis: "requested <slug> via comment on <date>"},
     tags: ["magnet:<slug>"]}`.
   - Draft the delivery DM: `outbox_draft {brand, kind: "dm", account, to: {leadId}, body, rationale:
     "requested via comment", sequence: {name: "magnet-<slug>", step: 1}}`. Body = thanks + link + one qualifying
     question (e.g. "Você atende quantos pacientes por semana?"). No pitch in message 1.
   - Email or WhatsApp delivery only if they gave that address/number for it; set `consent.email: "opt_in"` /
     `consent.whatsapp: "opt_in"` with the basis. Never add them to other campaigns without a separate opt-in.
6. **Nurture** (only if they reply or opt in): step 2 after 2-3 days = "did you try X? most people get stuck on Y";
   step 3 = relevant case study + soft offer. Leads who don't reply get no further cold nudges on that thread.
7. **Landing page copy** (if the magnet also lives on a page) in `reports/lead-magnet-<slug>.md`:
   headline (outcome + timeframe) · subhead (who it's for) · 3 bullets of what they'll get · preview image · form
   (email only; ask more only if it qualifies) · proof line · privacy line ("1 email with the guide + 3 tips. Unsubscribe
   anytime.") · thank-you page with the next step (book a call / WhatsApp link).
8. Report: magnet choice + rationale, content ids feeding it, the delivery template, metrics to track (comments →
   DMs sent → replies → qualified leads).

## Quality bar
- The magnet's title promises one specific outcome; the asset delivers it in < 15 minutes.
- Delivery goes only to requesters; consent basis recorded on each lead.
- Policy limits respected (`policy_status {account}`); big spikes queue up and send over the day — that's fine.

## Pitfalls
- "Ultimate guide" PDFs nobody reads. Short beats comprehensive.
- Pitching in the delivery message. Deliver, ask one question, listen.
- Treating a comment as consent for ongoing marketing. It isn't.

## Show it
When done, show the magnet outline, funnel and landing copy: an Artifact in Claude Code, else `report_open {path}`. See AGENTS.md › Show the result.
