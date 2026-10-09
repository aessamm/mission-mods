# Changelog

## mission-control 0.9.0 — first public release

- Agents tab: the main session and every sub-agent with pixel-crab characters, Your Team
  strip, details with a timeline of recent steps, model and effort per agent.
- Delegations tab: Codex, agy, OpenCode and Claude (claude-delegate) runs followed to their
  result, with diff and test counts.
- Board tab: `.ops/` tickets with what each is blocked by, milestones, agents' run stats
  and the latest decisions.
- Log tab, `/standup`, `/handoff`, `/ship`.
- Budget on the plan's 5-hour and weekly windows, or a daily dollar limit (`/budget`).
- Status line in detailed, semi-compact and compact layouts.
- Help › Works with, and the companion skills copied to `~/.claude/skills` when missing
  (Settings › Panel turns this off).
- Redraws only when something it shows changes; running clocks tick by the minute.
