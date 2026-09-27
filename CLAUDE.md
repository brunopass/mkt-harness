@AGENTS.md

## Claude Code specifics

- The `mkt` MCP server comes from `.mcp.json` (tools appear as `mcp__mkt__<name>`). Skills in `skills/` are linked
  into `.claude/skills/`, so `/trend-radar`, `/outreach`, ... work as slash commands.
- Subagents in `.claude/agents/`: researcher, strategist, copywriter, editor, sdr, community, publisher.
- **Claude in Chrome** (`mcp__claude-in-chrome__*`) drives the user's own main Chrome. Use it for research and for
  reading pages that need the user's personal session. Anything account-specific (posting, DMs, inboxes) belongs to the
  per-account mkt profiles. If you ever send through Claude in Chrome, it must be an `outbox_claim`ed item, closed with
  `outbox_complete`; log messages you read there with `conversation_log`. Close every Claude in Chrome tab you open
  (`tabs_close_mcp`) when you're done with it; for the mkt profiles, finish with `browser_done`.
- `.claude/settings.json` denies approving from the shell. Don't work around it.
- Deliverables: publish them with the Artifact tool when it's available (see AGENTS.md › Show the result); `report_open`
  is the local fallback and the only option for pages with contacts' personal data.
