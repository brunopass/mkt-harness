---
name: browser-ops
description: "Operate the per-account Chrome profiles safely: read-only research browsing, manual sends under an outbox claim when an adapter can't do the job, login/2FA hand-offs, rate-limit warnings, Claude in Chrome usage, and adapter calibration with dry runs. Use for \"do it in the browser\", \"adapter failed\", \"post by hand\", \"check if logged in\", \"calibrate the Instagram adapter\", \"browse this profile\". Not for deciding what to post or say (other skills)."
---

# browser-ops

The browser is where accounts live. Treat every click in a logged-in account as the brand speaking.
Global rules: [AGENTS.md](../../AGENTS.md). Platform playbooks: `references/platforms/<platform>.md`
(whatsapp, linkedin, instagram, x, tiktok, threads, facebook, youtube, email-gmail).

## The model
- Each account (`account_list {brand}`) has its own Chrome profile at `workspace/.profiles/<account>` with its own
  logins. The human logs in once: `mkt browser open <account>` (visible window, 2FA and all).
- Tools take `account` = which profile; `"research"` is the brand-neutral profile for reading the web. The window is real and visible (unless `browser.headless`); the human can
  watch everything.
- Deterministic adapters do posts/DMs/inbox reading via `outbox_dispatch`. You use the tools below for research,
  verification, and manual sends when an adapter can't.

## Tools
| Tool | Use |
|---|---|
| `browser_login_status {account}` | is the profile logged in? (temporary tab) |
| `browser_open {account, url?, newTab?}` | open/reuse the window, returns a snapshot + some text |
| `browser_navigate {account, url}` | go somewhere in the current tab |
| `browser_snapshot {account, text?, maxItems?}` | `[ref] role "name" (state)` lines for interactive elements |
| `browser_text {account, chars?}` | visible text (main region) — best for reading profiles/posts |
| `browser_screenshot {account, fullPage?}` | image + saved path under `workspace/.shots/` |
| `browser_scroll {account, direction?, pixels?, ref?}` | load more / bring an element into view |
| `browser_tabs {account, select?}` | list or switch tabs |
| `browser_click {account, ref}` · `browser_type {account, ref, text, clear?, submit?, newline?}` · `browser_press {account, key}` · `browser_upload {account, ref, files}` | acting (not available in headless routines unless enabled) |
| `browser_close {account}` | close the window; the login stays in the profile |

Refs (`e12`, `f2e5` in frames) come from the **latest** snapshot. After any click that changes the page, use the
snapshot returned by the action (or take a new one) before the next action. Stale ref → re-snapshot, don't guess.
In rich editors `browser_type` turns newlines into Shift+Enter (chat apps send on Enter); pass `newline: "enter"`
only where Enter makes a new line.

## Research browsing (read-only)
Use `account: "research"` by default: a separate Chrome profile that is not logged in as any brand (the human may
log it into personal/research accounts with `mkt browser open research`). Use a brand account's profile only when
the page needs that brand's own login (its insights, its inbox). Open, scroll, read text, screenshot. Do **not** like, follow, comment, connect, DM, join groups or accept cookies
walls that subscribe to things while researching. Keep sessions short on LinkedIn/Instagram (profile-view limits);
prefer public pages or WebFetch when no login is needed.

## Clean up (every time)
- Work in the harness's own tab: `browser_open` opens one; switching to the human's tabs (`browser_tabs {select}`) is
  for reading what they asked you to look at, never for acting.
- Done with the task (or stopping on a stop condition) → `browser_done {account}`. It closes only harness tabs, and
  Chrome if nothing else is open. In Claude in Chrome, close every tab you opened with `tabs_close_mcp`.
- Dry runs close their tab and keep the screenshot; pass `keepOpen: true` only when the human wants to look live.

## Manual send protocol (claim → do → verify → complete)
Only for an **approved** outbox item that the adapter can't handle (`unsupported`) or failed on (UI changed).
1. `outbox_claim {id}` → runs policy checks, locks the item, returns `token`, the item and the playbook path.
   If it refuses (blocked/deferred/not approved) — stop. Never send without a claim.
2. Read the playbook for the platform. Send **exactly** the approved text/media to exactly the approved recipient.
   No edits "to make it fit" — if it doesn't fit, `outbox_complete {ok: false, error: "…"}` and report.
3. Verify: message bubble visible / post URL exists / "Your post was shared" toast. Screenshot.
4. `outbox_complete {id, token, ok: true, url?, note?}` — or `ok: false, error` if anything failed.
   The claim is the audit trail; the lead, conversation and send counters update from it.
5. One attempt. If it fails, do not retry in a loop; report with the screenshot path.

## Stop conditions (hand to the human)
- Login page, "confirm it's you", checkpoint, 2FA prompt, captcha → stop; tell the human: `mkt browser open <account>`.
  Never try to solve captchas or type passwords.
- "Try again later", "action blocked", "we limit how often", "unusual activity", temporary restriction banners →
  stop using that account for the rest of the day, `outbox_complete {ok: false, error: "rate-limited: <text>"}` if
  you held a claim, and report. Consider lowering its limits in `mkt.config.yaml`.
- Anything asking to grant permissions, install extensions, change account settings or payment details → stop.

## Claude in Chrome (Claude Code only)
`mcp__claude-in-chrome__*` drives the user's own main Chrome (their personal logins).
- Good for: research on sites that need the user's personal session, reading dashboards/analytics the user has open.
- Account-specific work (posting, DMs, inboxes of brand accounts) belongs in the mkt profiles — default to them.
- If you ever send via Claude in Chrome: it must be a claimed outbox item, closed with `outbox_complete`; log messages
  you read there with `conversation_log {brand, account, messages}` so the conversation history stays complete.

## Adapter calibration (when a platform changes its UI)
1. Queue or pick an item for that account (a harmless draft is fine: dry runs work on pending items).
2. `outbox_dispatch {id, dryRun: true}` (human: `mkt send <id> --dry-run`) → fills the composer, stops before the
   final click, screenshots. In a visible window the filled tab stays open for inspection.
3. On failure the error names the step (`compose`, `upload`, `caption`, `send`…) and saves a screenshot. Open the
   page yourself with the browser tools, find the element in `browser_snapshot`, and write down its role/name in the
   platform playbook's calibration section. Report the step + the new locator so a developer can update
   `src/browser/adapters/<platform>.ts` (several candidates per step; role/label first).
4. Re-run the dry run until it passes; only then let real sends go.

## Pitfalls
- Acting on refs from an old snapshot (wrong element).
- Using one account's profile to look at another brand's stuff while logged in as the brand.
- Leaving a filled composer from a dry run and later clicking send "to finish it" — that's a send without a claim.
