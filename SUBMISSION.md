# Anthropic plugin directory: submission draft

Draft answers for submitting Mission Control to the Anthropic plugin directory. Review each
one before pasting it into the form.

## Source

| Field | Answer |
| --- | --- |
| Repository | `aessamm/mission-mods` (https://github.com/aessamm/mission-mods) |
| Plugin path | `mission-control` |
| Branch | `main` |
| Version | 0.9.2 |
| Licence | MIT |
| Author | Ahmed Essam Mohamed Elhabiby (@aessamm) |

## Listing

**Name:** Mission Control

**Short description (one line):**
Your agent team at a glance: live sub-agents, delegations, an .ops ticket board, a daily
log and a plan-aware budget, in a side panel and a status line.

**Long description:**
Mission Control shows everything your Claude Code session is doing in one place. The Agents
tab lists the main session and every sub-agent as a pixel-crab character, with what each is
doing, time, tokens, cost, progress and a timeline of recent steps; you can change an
agent's model or effort, send it a note, or stop it. Delegations follows tasks handed to
Codex, Antigravity, OpenCode or another Claude to their result, with diff and test counts.
Board reads the repository's `.ops/` tickets: what is in progress, in review, blocked, and
what each ticket is waiting on. Log keeps the day across projects, with `/standup`,
`/handoff` and `/ship`. A budget can pause new sub-agents at a share of your plan's 5-hour or
weekly window, or at a daily dollar limit. A status line above the prompt shows the folder,
git state, context and usage.

It runs locally, sends nothing over the network, and never merges, pushes or opens a pull
request.

**Category:** Productivity / developer tools
**Keywords:** agents, sub-agents, status line, delegation, kanban, budget

**Requirements:** Claude Code with hooks modules (mods). Developed and tested on 2.1.289 and
2.1.293. Full look in the desktop app's Code tab; text version in the terminal.

## Data handling

**Does the plugin collect personal data?**
No. It does not collect, store or transmit personal data. It reads the local git state of
the open repository, the repository's `.ops/` folder, delegate result files in the temp
folder and Claude Code's own plugin records, only to display them.

**Is any data sent to third parties?**
No. The plugin makes no network requests of its own: no telemetry, no analytics, no
external APIs. `/standup`, `/handoff` and `/ship` ask the session's own model to write text
through Claude Code's existing connection, the same as a prompt the user types.

**Where is data stored, and for how long?**
Locally, in Claude Code's plugin store on the user's machine: the plugin's settings, the
day log (at most 300 entries per day), handoff notes per project and daily spend counters.
Nothing is written to the repository. The companion skills are copied to
`~/.claude/skills` only when missing (this can be turned off in Settings › Panel). All of
it is removed by uninstalling the plugin and deleting those skill folders.

**Is the plugin directed at users under 18?**
No. It is a developer tool for Claude Code users and is not directed at children.

**Does it run commands on the user's machine?**
Only read-only `git` commands (status, log, stash list, diff --shortstat, rev-parse,
rev-list) in the open repository and in delegation folders. The full list is in the README
under "What it does on your machine".

**Does it change the user's settings?**
No. The optional installer scripts in `install/` edit `~/.claude/settings.json`, but only
when the user runs them; the plugin itself never does.

## Pre-submission checklist

- [ ] `claude plugin validate mission-control` passes.
- [ ] `claude plugin validate .` passes (marketplace).
- [ ] `claude plugin test mission-control` passes.
- [ ] `plugin.json` version matches the CHANGELOG (0.9.2) and the tag to be released.
- [ ] README "What it does on your machine" matches the code (commands, files read and
      written, network).
- [ ] LICENSE and THIRD_PARTY_NOTICES.md are present and current (Lucide ISC,
      savvy-progress MIT, delegate-skills MIT).
- [ ] Installed from a clean machine through each README path: Windows installer, macOS or
      Linux installer, and `/plugin install` in a terminal.
- [ ] Tested on macOS and Linux (only Windows has been tested so far).
- [ ] Changes pushed to `main`, and a `v0.9.1` release created with the CHANGELOG entry.
- [ ] Listing screenshots or a short video ready (the promo videos can be used).
- [ ] No secrets, personal paths or test data in the repository.
