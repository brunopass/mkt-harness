---
name: script-writer
description: "Write the actual content for a content item: short-form video scripts (reels/TikTok/Shorts), carousels (renderable slides), LinkedIn posts, X threads, captions per platform, YouTube Shorts titles, newsletters/emails. Use for \"write the script\", \"write the carousel\", \"caption this\", \"turn this idea into a post\", \"draft the newsletter\". Not for picking ideas (idea-engine), adapting one finished piece to many platforms (repurpose), or 1:1 outreach messages (outreach)."
---

# script-writer

Take a scored idea to publish-ready copy in the brand's voice and the customer's words.
Global rules: [AGENTS.md](../../AGENTS.md). Libraries: [hooks](references/hooks.md) · [formats & specs](references/formats.md).

## Inputs
- `brand`, content `id` (or create one), target platform(s) and language(s).

## Workflow
1. `content_get {brand, id}` → brief, persona, hook, CTA, format. `brand_context {brand, persona}` → voice, offers,
   proof, language bank. Missing brief? Write it first (see idea-engine brief block).
2. Write **3 hook options** using different formulas from `references/hooks.md`; pick the strongest (specific,
   tension, persona's words, promise the body keeps). Keep the others in the body under `## Alt hooks`.
3. Write the format (templates below). Pull at least one verbatim phrase from the language bank.
4. Write captions: `## Caption` (default) and `## Caption: <platform>` for any platform that needs different length,
   CTA mechanics or hashtags (see formats). `content_schedule` picks `## Caption: <platform>` first.
5. Self-check with the checklist below, then `content_update {brand, id, body, hook, cta, status: "draft"}`.
   For carousels/images: `content_render {brand, id}` and look at the PNGs (Read the files) — fix overflowing slides.
6. Hand to the `editor` subagent (Claude Code) or re-read against `voice.md` yourself; set `status: "review"`.

## Short-form video (reel / short / TikTok) — 20-45s default
- **0-2s hook**: on-screen text + first spoken line + a visual hook (movement, unexpected object, result shown first).
  The on-screen text is not the same sentence as the voiceover; they reinforce.
- **Retention beats every 3-5s**: new visual, cut, zoom, text pop, pattern interrupt ("but here's the catch").
- **Payoff** before second 25-30 (deliver the promise; no bait).
- **CTA** (1 line, specific): "Comenta GUIA que te mando o checklist" / "Guarda esto para tu próxima reunión".
- Loop: last line leads back into the first where natural.
Body format:
```
## Script
| t | visual (shot / b-roll) | voiceover | on-screen text |
|---|---|---|---|
| 0-2s | Close-up: phone with 14 unread DMs | "You're losing sales in your DMs." | PERDENDO VENDAS NA DM? |
| 2-6s | … | … | … |

## Shot list
- A-roll: talking head, eye level, window light; B-roll: screen recording of …; props: …
## Edit notes
- Captions burned in, 5-7 words per line, safe zones (avoid bottom 20% / right 15%).
```

## Carousel (Instagram / LinkedIn document) — 6-10 slides
- Slide 1 = cover: the hook, ≤ 12 words, one idea. Slide 2 = why it matters / the stakes.
- One idea per slide, ≤ 35 words; bullets ≤ 4; make each slide screenshot-worthy.
- Second-to-last = summary/"steal this"; last = CTA (save / comment keyword / follow / link in bio).
- Renderable format (`content_render` reads exactly this):
```
## Slides

### Slide 1
Stop losing **half your leads** in the DMs
Swipe →

### Slide 2
Why it happens
- Replies take 9h on average
- ...

### Slide 8
Want the checklist?
Comment **GUIA** and I'll send it
```
  `**word**` = accent colour; `==word==` = highlighted; `- ` bullets; heading `### Slide N` then first line = title,
  or `### Your title` directly.

## LinkedIn post (text)
Hook line (≤ 140 chars, before "…see more") + line 2 that raises the stakes → short paragraphs (1-2 lines) → the
insight/framework (numbered) → proof → one question or CTA. 900-1,500 chars performs well; no external link in the
body (put it in the first comment if needed, flag it for the publisher). 0-3 hashtags.

## X thread
Tweet 1 = hook + promise ("n lessons / how I…"), ≤ 280 chars, no link. 5-10 tweets, one idea each, numbered
optional. Last tweet: summary + CTA (follow / reply / link). Each tweet must stand alone if quoted.

## YouTube Shorts
Title ≤ 60 chars (100 max), curiosity + keyword; description first line = keyword sentence; same script rules.

## Newsletter / email
Subject (4-7 words, specific, no clickbait; see outreach for cold email) + preview text (40-90 chars that extends,
not repeats) → one story or insight → one lesson → one CTA. Plain-text-looking > designed. ≤ 300 words for weekly.

## Checklist (fail any → rewrite)
- Hook uses the persona's words or a specific number/situation; no "In today's post…".
- The body pays off the hook exactly; no bait-and-switch.
- One idea, one CTA. CTA matches the funnel stage (tofu: save/follow; mofu: comment keyword/lead magnet; bofu: DM/book).
- Every claim is in the proof bank; no invented stats, testimonials or "clients like X".
- Banned words absent (`brand.yaml banned`); voice rules followed; reading level ~grade 6-8.
- Platform limits respected (formats.md); hashtags per platform norms.
- Written natively in the target language; regional choices consistent (pt-BR "você/celular"; es-ES "vosotros/móvil"
  vs LATAM "ustedes/celular"; en-US spelling unless brand says UK).

## Pitfalls
- Scripts that read well but can't be filmed: every visual line must be shootable with the stated capacity.
- Carousel slides with paragraphs; if it doesn't fit at 38px, split the slide.
- Ending with three CTAs. Pick one.

## Show it
When done, show the batch: scripts, captions and rendered slides together on one page: an Artifact in Claude Code, else `report_open {path}`. See AGENTS.md › Show the result.
