# Mission Mods

Mods for [Claude Code](https://claude.com/claude-code) that help you lead a team of AI
agents. The first one is **Mission Control**; Guardrails and Brain are on the way.

## Mission Control

Your agent team at a glance, in a side panel and a status line above the prompt.

- **Agents** — the main session and every sub-agent as a pixel-crab character: what each is
  doing, time, tokens, cost, progress, and a timeline of recent steps. Change an agent's
  model or effort, send it a note, or stop it.
- **Delegations** — tasks handed to Codex, Antigravity (agy), OpenCode or another Claude
  through the delegate skills, followed to their result with diff and test counts, with the
  GitHub issue each one is for. Runs other sessions logged through Mission Control's
  `run-log.mjs` today show up too. When a finished run's GitHub card is behind, a button
  offers to move it to Review or Done, and **Sync board** offers Mission Control's
  `board-sync.mjs`; both only fill the composer.
- **Board** — the repo's GitHub issues in their board columns when Mission Control has them
  cached, else tickets from the repo's `.ops/` folder: doing, review, waiting on owner,
  blocked, to do, the agents' run stats and the latest decisions. Pick a ticket and
  **Start** fills the composer with its delegation request; **Open** goes to the issue.
- **Log** — the day across projects, with `/standup`, `/handoff` and `/ship`.
- **Budget** — pauses new agents at a share of your plan's 5-hour or weekly window, or at a
  daily dollar limit.
- **Waiting on you** — rows under the status line for GitHub issues in Waiting on owner,
  runs waiting for your review and failed runs, each with a button that fills the composer;
  a toast when an owner issue appears.
- **Status line** — folder and git, context, 5-hour and weekly usage, the last turn and the
  running agents; detailed, semi-compact or compact.

## Install

Pick the one that matches how you use Claude Code. You run these yourself; Claude can't
change its own settings file for you.

**Claude desktop app, Windows.** Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/aessamm/mission-mods/main/install/install.ps1 | iex
```

**Claude desktop app, macOS or Linux.** Open a terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/aessamm/mission-mods/main/install/install.sh | bash
```

Both scripts add the Mission Mods marketplace and turn on Mission Control in your Claude
settings file (`~/.claude/settings.json`, or the folder `CLAUDE_CONFIG_DIR` points to). They
back the file up first, keep everything else in it, and change nothing if you run them
again. Then quit the Claude desktop app completely, open it again, start a new session in
the Code tab and type `/mission`.

**Terminal (Claude Code CLI).** In a Claude Code session running in a terminal:

```
/plugin install mission-control --marketplace aessamm/mission-mods
```

This command only works in a terminal session; the desktop app's Code tab doesn't accept it.
Answer `y` to add the marketplace and choose the **user** scope, so Mission Control also
loads in the desktop app. Open the panel any time with `/mission`.

**Requirements:** Claude Code 2.1.293 or newer (mods with hooks modules). It draws its full
look in the desktop app's Code tab and a text version in the terminal. Built and tested on
Windows; macOS and Linux should work but have not been tested yet.

### Manual install

If you'd rather edit the file yourself, open `~/.claude/settings.json` (on Windows,
`%USERPROFILE%\.claude\settings.json`) and add these two entries inside the outer `{ }`:

```json
"extraKnownMarketplaces": {
  "mission-mods": { "source": { "source": "github", "repo": "aessamm/mission-mods" } }
},
"enabledPlugins": {
  "mission-control@mission-mods": true
}
```

- Put a comma after the entry that comes before them, or the file stops being valid JSON.
- If the file already has an `enabledPlugins` (or `extraKnownMarketplaces`) section, add the
  line inside that section instead of adding a second one.

Save, quit the Claude desktop app completely and open it again.

## Commands

| Command | What it does |
| --- | --- |
| `/mission [tab]` | Open the panel, or jump to a tab: agents, delegations, board, log, settings, help, info |
| `/standup` | Today across every project: done, doing, blocked, next |
| `/handoff [note]` | Write the note the next session starts from |
| `/ship` | PR description, changelog and a client update, after checks (with a GitHub board: the issues the branch's commits name, and which are not in Review yet) |
| `/budget 5h <percent>` | When new agents pause: a share of the 5-hour window, `week <percent>`, `plan`, `auto` or a daily dollar amount |

## Companion skills

Mission Control ships five skills and copies any that are missing to `~/.claude/skills`
when a session starts. A copy you already have is never touched. Turn this off in
**Settings › Panel › Install companion skills**.

| Skill | What it does | Shown in |
| --- | --- | --- |
| `ai-team-project-kickoff` | Plans a project for a team of AI agents and writes the `.ops/` layer | Board |
| `codex-delegate` | Hands a coding task to the Codex CLI | Delegations |
| `agy-delegate` | Hands a coding task to Google Antigravity | Delegations |
| `opencode-delegate` | Hands a coding task to the OpenCode CLI | Delegations |
| `claude-delegate` | Hands a coding task to a separate Claude Code process | Delegations |

The delegate skills need their own CLIs (`codex`, `agy`, `opencode`, `claude`) and Node.js.

## What it does on your machine

Everything runs locally, and Mission Control sends nothing over the network. In short: it
runs read-only `git` commands, reads `.ops/`, Mission Control's GitHub cache, delegate
results and Claude Code's plugin records, copies the companion skills when they are missing, and only starts or stops an
agent when you press a button for it. The full list of every program it runs, every hook
and what it changes, and every file it reads and writes is in
[mission-control/README.md](mission-control/README.md#what-it-does-on-your-machine).

## Troubleshooting

**"This command isn't available" in the desktop app.** `/plugin install` only runs in a
terminal session. In the desktop app, use the installer for your system above.

**Mission Control isn't in Plugins › Discover.** It isn't in the official plugin directory
yet. Install it with one of the options above instead.

**"Claude Code … is older than 2.1.293".** Update the Claude desktop app (or run
`claude update` for the CLI), then open it again.

**`/mission` does nothing.**
1. Quit the Claude desktop app completely, including from the system tray or menu bar,
   open it again and start a new session. Settings are only read when the app starts.
2. If you have the CLI, run `claude plugin list` and check that `mission-control@mission-mods`
   is listed as enabled.
3. Check that your settings file has both entries from [Manual install](#manual-install), and
   that the file is valid JSON.

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Ahmed Essam Mohamed Elhabiby
([@aessamm](https://github.com/aessamm)). It includes Lucide icons (ISC), crab art from savvy-progress
(MIT) and the delegate skills from delegate-skills (MIT); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
