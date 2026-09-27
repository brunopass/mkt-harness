---
name: repurpose
description: "Turn one pillar asset (a long video, podcast, webinar, article, winning post or case study) into platform-native variants — reels/shorts, carousels, LinkedIn post, X thread, Threads, newsletter, stories — as linked content items. Use for \"repurpose this\", \"turn this video/article into posts\", \"cut this into clips\", \"reuse our best post\". Not for writing a single new piece from scratch (script-writer) or for posting (publish)."
---

# repurpose

One idea, many native shapes. Each variant is rewritten for how that platform is consumed — never copy-paste the
same text everywhere. Global rules: [AGENTS.md](../../AGENTS.md). Specs: `skills/script-writer/references/formats.md`.

## Inputs
- `brand`; the source: a content id (`content_get`), a URL (WebFetch / transcript the human provides), or a file.
- Target platforms (default: the brand's active accounts from `account_list {brand}`) and languages.

## Workflow
1. Load the source and `brand_context {brand, persona}`. If it's a video/podcast, you need a transcript (ask the
   human or use a provided file; don't fabricate quotes).
2. **Mine atoms** from the source (aim 8-15): each atom = one standalone idea: a claim + proof, a story, a stat, a
   framework, a mistake, a quote, an objection answered, a before/after. Note timestamps for video atoms.
3. **Score atoms** quickly (hook potential × persona fit × proof) and pick the top 3-6.
4. **Build the matrix** (write it in the source item's body under `## Repurpose plan` via `content_update … appendBody`):
   | Atom | Reel/Short/TikTok | Carousel | LinkedIn | X thread | Threads | Newsletter | Story/Status |
   Fill each cell with the angle, or "—" when the atom doesn't suit the platform.
5. **What changes per platform** (rewrite, not trim):
   - Short video: lead with the most visual/emotional moment, 20-45s, burned-in captions, new 2s hook
     (not the original intro), CTA to save/comment.
   - Carousel: turn the framework/list into one-idea-per-slide; cover = the sharpest claim.
   - LinkedIn: first-person lesson + professional stakes; paragraphs of 1-2 lines; question at the end; link in comment.
   - X: compress to punchy lines; thread for frameworks, single post for a stat or contrarian line.
   - Threads: conversational, a question that invites replies; 1 topic tag.
   - Newsletter: the deeper "why" + story + one CTA; link back to the full asset.
   - Stories/WhatsApp status: poll or question sticker around the atom → DMs.
   - Languages: rewrite natively per language (different examples/idioms), then treat as separate items.
6. For each chosen cell: `content_create {brand, title, status: "draft", format, platforms: [<one platform>],
   pillar, persona, funnel, hook, cta, language, body}` with body including `## Source` (source id/URL + timestamp)
   and the platform-specific sections (`## Script`, `## Slides`, `## Caption: <platform>`). For carousels run
   `content_render {brand, id}`.
7. Suggest a staggered schedule (don't schedule): best first on the platform where the source already proved itself,
   then 2-4 days apart on others; newsletter last with links to all.
8. Report the matrix and the created ids.

## Quality bar
- Each variant stands alone (makes sense to someone who never saw the source).
- Each variant has a new hook written for that platform's first second/line.
- No watermarks from other platforms; captions burned in for video.
- Clip timestamps point to real moments in the source.

## Pitfalls
- Posting the same caption on 5 platforms on the same day (looks automated, cannibalises reach).
- Cutting clips that need the previous minute of context: pick self-contained atoms.
- Losing the CTA: every variant still feeds a lead path.

## Show it
When done, show the asset matrix (source piece → every derived piece): an Artifact in Claude Code, else `report_open {path}`. See AGENTS.md › Show the result.
