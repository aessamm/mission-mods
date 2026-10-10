# Changelog

## mission-control 0.9.2 — ready for the Claude directory

- The plugin's own README now covers what it does, setup, commands, and everything it does
  on your machine: the programs it runs, the agents and tools it starts and when, what each
  hook changes, and the files it reads and writes.
- A listing icon (`.claude-plugin/icon.png`).
- Code tidy-ups the directory's checks asked for: no variable named `h` in the JSX files, and
  the byte-order-mark regex written as an escape.

## mission-control 0.9.1 — easier install, every system

- One-line installers for the Claude desktop app: `install/install.ps1` (Windows) and
  `install/install.sh` (macOS, Linux). They add the marketplace and turn the plugin on in
  your settings file, back it up first, keep everything else, and change nothing on a second
  run.
- README: three install paths, a manual install, troubleshooting, and a full account of what
  Mission Control does on your machine.
- Works the same on Windows, macOS and Linux: home, temp and Claude folders found per
  system, `CLAUDE_CONFIG_DIR` respected for the companion skills and plugin records, and a
  delegation brief given as `~/…` read from the home folder.
- `SUBMISSION.md`: draft answers for the Anthropic plugin directory.

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
