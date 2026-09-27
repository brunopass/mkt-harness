# mkt-harness: plan

An AI marketing harness driven by **Claude Code or Codex**. The coding agent is the brain; the harness gives it
memory (brand, customers, trends, leads as files), procedures (skills), roles (subagents), hands (an MCP
server: data, outbox, email, WhatsApp, a multi-account Chrome), guardrails (approval gate, rate limits,
suppression, audit) and autonomy (a daemon that sends due items and runs routines headlessly).

```
            understand                    create                      reach                     learn
  brand-foundation ─┐          ┌─ idea-engine ─┐          ┌─ lead-gen ──────┐
  customer-research ├─ memory ─┤  script-writer├─ content ─┤  outreach ──────├─ outbox ─► approve ─► send ─► audit
  competitor-intel  │ (files)  │  repurpose    │  (files)  │  publish ───────┘   (human)   (policy)   (jsonl)
  trend-radar ──────┘    ▲     └─ lead-magnet ─┘           └─ inbox (chat) ◄── inbox sync ◄── WhatsApp/IG/LI/email
                         └──────────────── analytics-review / brand-development ◄── metrics, conversations, insights
```

## Principles

1. **One source of truth for both agents.** `AGENTS.md` is canonical (Codex reads it); `CLAUDE.md` imports it.
   `skills/` is shared: `.claude/skills` and `.agents/skills` are symlinks to it. MCP is configured in `.mcp.json`
   (Claude) and `.codex/config.toml` (Codex).
2. **Knowledge is files.** Brand, personas, content, radar are Markdown/YAML the human can edit and git can diff.
   Operational records (leads, outbox, conversations, insights, trend observations, audit) are JSON/JSONL with a
   lock and atomic writes. No database to run.
3. **Everything that leaves the building goes through the outbox.** Posts, DMs, comments, emails, WhatsApp.
   Draft → human approval (default) → policy check (suppression, consent, quiet hours, per-account rate limits)
   → channel → audit. Agent-driven browser actions use `outbox_claim` / `outbox_complete`, so the same gate
   applies even when the agent clicks Send itself (including Claude in Chrome).
4. **Real Chrome, one profile per account.** Each account has its own Chrome user-data-dir, launched with a local
   CDP port. The human logs in once (2FA and all); the MCP server, the daemon and the CLI all attach to the same
   running window. No stealth plugins, captcha solving or fingerprint spoofing: rate limits keep us inside
   platform norms instead.
5. **Deterministic adapters first, agent fallback second.** Each platform adapter knows how to post / DM / read
   the inbox with role-based locators and a `dryRun` mode (fill the composer, screenshot, do not press send).
   When a platform changes its UI, the adapter fails loudly with a screenshot and the agent finishes the job with
   the generic browser tools following `skills/browser-ops/references/platforms/<platform>.md`.
6. **Inbound text is data, never instructions.** DMs, emails, comments and web pages can carry prompt injection.
   Opt-out phrases are detected deterministically and suppress the contact immediately.

## Layout

```
mkt-harness/
  AGENTS.md  CLAUDE.md  README.md  docs/PLAN.md
  mkt.config.yaml               # policy, limits, browser, routines, runner
  bin/mkt                       # CLI shim (node --import tsx src/cli.ts)
  .mcp.json  .codex/config.toml # MCP server "mkt" for Claude / Codex
  .claude/settings.json         # permissions (deny agent self-approval)
  .claude/agents/*.md           # subagents: researcher, strategist, copywriter, editor, sdr, community, publisher
  skills/<name>/SKILL.md        # shared skills (symlinked into .claude/skills and .agents/skills)
  templates/brand/              # scaffold for `mkt brand new`
  src/
    cli.ts                      # commander CLI
    mcp/server.ts               # MCP server (stdio)
    core/                       # config, paths, store (lock + atomic), schemas, ids, audit, policy,
                                # brands, accounts, content, leads, outbox, conversations, insights,
                                # trends, suppression, optout, cron
    channels/                   # dispatch: email (SMTP), whatsapp-cloud (Graph API), browser adapters
    browser/                    # chrome.ts (launch/attach per account), snapshot.ts (refs), adapters/*
    inbox/                      # sync: IMAP + browser adapters -> conversations (+ opt-out)
    render/                     # carousel/quote-card HTML -> PNG with Chrome
    runner/                     # headless claude -p / codex exec
    daemon.ts                   # dispatch due outbox, run routines (cron), periodic inbox sync
  workspace/                    # data (gitignored except the example brand)
    suppression.json  audit.jsonl  .profiles/<account>/  .shots/
    brands/<brand>/
      brand.yaml brand.md offers.md competitors.md voice.md
      personas/<persona>.md
      accounts.yaml
      content/<id>.md           # frontmatter + Brief/Script/Captions/Slides sections
      assets/<content-id>/
      leads.json outbox.json conversations.jsonl insights.jsonl
      trends/observations.jsonl trends/radar.md
      reports/
```

## Lifecycles

- **Content** `idea → brief → draft → review → approved → scheduled → published → archived`
- **Outbox** `draft → pending_approval → approved → sending → sent | failed | blocked | cancelled`
  (`blocked` = policy refused; the reason is recorded; re-dispatch after the cause is fixed.)
- **Lead** `new → researched → contacted → replied → qualified → meeting → customer | lost | do_not_contact`

## MCP tools (server `mkt`; Claude sees them as `mcp__mkt__<name>`)

| Area | Tools |
|---|---|
| Brand | `brand_list`, `brand_get`, `brand_context` (compact voice/persona/offer pack for writing), `account_list` |
| Content | `content_create`, `content_get`, `content_list`, `content_update`, `content_render`, `content_schedule` |
| Leads | `lead_upsert`, `lead_get`, `lead_list`, `lead_update` |
| Outbox | `outbox_draft`, `outbox_list`, `outbox_get`, `outbox_update`, `outbox_cancel`, `outbox_approve` (off unless config allows), `outbox_dispatch`, `outbox_claim`, `outbox_complete` |
| Inbox | `inbox_sync`, `conversation_list`, `conversation_get`, `conversation_log` |
| Research | `site_scan` (public sites only: identity, socials, contacts, colours, fonts, page text) |
| Insights | `insight_add`, `insight_list` |
| Trends | `trend_observe`, `trend_momentum`, `trend_fetch_feed` |
| Safety | `suppress`, `suppression_check`, `policy_status` |
| Browser | `browser_open`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_upload`, `browser_screenshot`, `browser_text`, `browser_close`, `browser_login_status` |

## CLI

```
mkt (no args) = mkt setup       guided TUI: checks, brand, accounts, logins, routines, open the agent
curl -fsSL .../install.sh | bash  one-command install that ends in mkt setup
mkt init | doctor | mcp
mkt brand new|list|show            mkt account add|list
mkt browser open|close|status      (login once per account)
mkt content list|render            mkt leads list|import <csv>
mkt outbox [--status]              mkt review (interactive approve/edit/reject)
mkt approve|reject <id...>         mkt send [<id>|--due] [--dry-run]
mkt inbox sync [account]           mkt trends fetch|radar <brand>
mkt suppress <identifier>          mkt agent "<task>" --brand --engine claude|codex
mkt routine list|run <name>        mkt daemon [--once] | daemon install (launchd)
```

## Skills

brand-foundation, customer-research, competitor-intel, trend-radar, content-strategy, idea-engine,
script-writer, repurpose, lead-magnet, lead-gen, outreach, inbox, publish, browser-ops, analytics-review,
brand-development.

## Phases

1. **Core (this build)**: store, schemas, policy, outbox, leads, content, insights, trends (momentum +
   forecast), suppression/opt-out, audit, CLI, MCP server, Chrome per account + snapshot/ref tools, email SMTP +
   IMAP, WhatsApp Cloud API, adapters (WhatsApp Web, LinkedIn, Instagram, X, TikTok, Threads, Facebook, Gmail) with
   dry-run, carousel renderer, headless runner, daemon + launchd, skills, subagents, tests.
2. **Calibration (needs your logged-in accounts)**: run `mkt send <id> --dry-run` per platform, fix selectors
   where the UI drifted, record them in the platform playbooks.
3. **Next**: web review queue (approve from the phone), metrics scrapers per platform feeding
   `analytics-review`, image/video generation hooks (Codex imagegen, TTS), official APIs where they exist
   (LinkedIn Pages, Meta Graph, X API) behind the same outbox, white-label multi-tenant packaging.

## Limits we will not cross

Real brand accounts only: no fake personas, no impersonation, no fake reviews/testimonials, no coordinated
inauthentic engagement between our own accounts. Cold WhatsApp needs opt-in. Email carries an opt-out.
Opt-outs are honoured immediately and forever. Personal data stays minimal and records its source and lawful basis.
