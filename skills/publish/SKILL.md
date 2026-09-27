---
name: publish
description: "Get approved content live: pre-flight format checks, schedule across accounts with content_schedule (staggered), dry-run new platforms/accounts, dispatch approved posts, verify they're live, and run the first-hour routine (first comment, replies). Use for \"schedule this\", \"post this\", \"publish the week\", \"queue posts\", \"did it go out?\". Not for writing the content (script-writer) or 1:1 messages (outreach/inbox)."
---

# publish

From "approved copy" to "live and verified" without surprises. Global rules: [AGENTS.md](../../AGENTS.md) — posts
go through the outbox and a human approves them in `mkt review` (unless config auto-approves posts).

## Inputs
- `brand`, content ids (or `content_list {brand, status: ["approved","review","draft"]}`), accounts, target dates.

## Pre-flight (per item, per platform) — fix before scheduling
- `content_get {brand, id}`: status is `review`/`approved`; the `editor` pass happened (Claude Code) or you re-read
  it against `voice.md`.
- Caption exists for each platform: `## Caption: <platform>` if the default `## Caption` breaks a limit or a norm
  (IG 2,200 chars / 3-5 hashtags; LinkedIn hook in first ~140 chars, links in comment; X ≤ 280 unless Premium;
  Threads ≤ 500; TikTok keywords in first line). Specs: `skills/script-writer/references/formats.md`.
- Media: carousels rendered (`content_render {brand, id}`) and PNGs look right (Read the images); videos exist at the
  paths in `media`, 9:16 for reels/shorts/TikTok, no other platform's watermark. Instagram and TikTok posts need media;
  YouTube needs a video and a title (the item title is used as the subject for `video`/`short` formats).
- CTA and link mechanics fit the platform (link in bio / comment keyword / first comment).
- Language matches the account's audience.

## Workflow
1. Pre-flight all items; list fixes needed; make them (or hand back to script-writer).
2. **Pick times** in the brand's timezone (`brand.yaml timezone`): start from formats.md heuristics, then prefer our
   own best slots from the latest `reports/week-*.md`. Stagger: the same content across accounts ≥ 60-120 min apart;
   never two posts on one account within the policy gap (`policy_status {account}` shows limits).
3. Schedule: `content_schedule {brand, id, accounts: [<ids>], at: "<ISO datetime with offset>", rationale}` — one call
   per time slot (call again with other accounts/times to stagger). It creates one `post` outbox item per account
   (pending approval) and marks the content `scheduled`.
4. **New platform or account? Dry-run first**: `outbox_dispatch {id: <outbox id>, dryRun: true}` → fills the composer
   and returns a screenshot without posting. Look at it (Read the PNG). Broken? Note the step from the error and
   see browser-ops calibration. Human equivalent: `mkt send <id> --dry-run`.
5. Tell the human what's waiting: `mkt review` (count per account/day). You don't approve.
6. **Sending**: the daemon (`mkt daemon`) sends approved items when due. To send approved, due items now:
   `outbox_dispatch {due: true}` or `{id}`. Results: `sent` (url), `deferred` (waits: quiet hours don't apply to posts,
   rate/gap limits do), `blocked` (read the reason), `failed` (error + screenshot).
7. **Failed with "unsupported"/adapter error** → browser-ops claim protocol: `outbox_claim {id}` → follow the platform
   playbook → verify → `outbox_complete {id, token, ok, url}`. Never re-dispatch in a loop; one retry at most after a
   fix, then report.
8. **Verify** each sent post: open `result.url` (or the profile) with `browser_open {account, url}`; check media order,
   caption formatting, link, first frame. `outbox_list {brand, status: ["sent"]}` shows urls.
9. **First-hour routine** (boosts distribution):
   - First comment when planned (LinkedIn link, IG keyword instructions): `outbox_draft {brand, kind: "comment",
     account, to: {url: <post url>}, body}`.
   - Run the `inbox` skill ~30-60 min after posting; reply drafts to comments/DMs quickly (people who comment
     are the warmest audience).
   - Don't engage with our own post from our other accounts to inflate it (AGENTS.md rule 4).
10. Content status becomes `published` automatically when all its scheduled accounts have posted; the `published`
    list on the item holds urls for analytics-review.

## Quality bar
- Zero items scheduled with missing media, broken limits or untranslated captions.
- Every new account/platform had a successful dry run before its first real post.
- Every sent post verified by URL within the hour.

## Pitfalls
- Scheduling in UTC by accident — always include the offset for the brand's timezone.
- Mass-scheduling the same caption to every account at the same time.
- Treating `deferred` as failure; it's the policy spacing things out.
- Editing an approved item's text: it goes back to pending approval (by design) — tell the human.
