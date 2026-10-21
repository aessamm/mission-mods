# Mission Control

Your agent team at a glance, in a side panel and a status line above the prompt. Part of
[Mission Mods](https://github.com/aessamm/mission-mods).

Mission Control is a mod for Claude Code. It watches the session you are working in and
shows what the main session and each sub-agent is doing, the tasks you hand to other coding
CLIs, the repository's tasks (GitHub issues through Mission Control, or the `.ops/` folder),
and the day's work across projects.
Everything runs locally.

## What you get

- **Agents**: the main session and every sub-agent as a pixel-crab character: what each is
  doing, time, tokens, cost, progress, and a timeline of recent steps. Change an agent's
  model or effort, send it a note, retry it or stop it.
- **Delegations**: tasks handed to Codex, Antigravity (agy), OpenCode or another Claude
  through the delegate skills, followed to their result with diff and test counts, with the
  GitHub issue each one is for. Runs other sessions logged through Mission Control's
  `run-log.mjs` today show up too.
- **Board**: the repository's GitHub issues in their project-board columns (doing, review,
  waiting on owner, blocked, to do) when a Mission Control folder has them cached, else the
  tickets in its `.ops/` folder with what each one is blocked by; plus the activity log, the
  agents' run stats and the latest decisions.
- **Log**: the day across projects, with `/standup`, `/handoff` and `/ship`.
- **Budget**: pauses new sub-agents at a share of your plan's 5-hour or weekly window, or at
  a daily dollar limit.
- **Status line**: folder and git, context, 5-hour and weekly usage, the last turn and the
  running agents.

## Setup

Requires Claude Code 2.1.293 or newer. Install it from the Claude directory, or see the
[repository README](https://github.com/aessamm/mission-mods#install) for the desktop app
installers and the terminal command. Then start a new session and type `/mission`.

## Commands

| Command | What it does |
| --- | --- |
| `/mission [tab]` | Open the panel, or jump to a tab: agents, delegations, board, log, settings, help, info |
| `/standup` | Today across every project: done, doing, blocked, next |
| `/handoff [note]` | Write the note the next session starts from |
| `/ship` | PR description, changelog and a client update, after checks (with a GitHub board: the issues the branch's commits name, and which are not in Review yet) |
| `/budget 5h <percent>` | When new agents pause: a share of the 5-hour window, `week <percent>`, `plan`, `auto` or a daily dollar amount |

## Companion skills

The plugin ships five skills: `ai-team-project-kickoff`, which plans a project and writes
the `.ops/` folder, and `codex-delegate`, `agy-delegate`, `opencode-delegate` and
`claude-delegate`, which hand a coding task to that CLI. When `MC_RUN_LOG` points at Mission
Control's `run-log.mjs`, the Codex, agy and OpenCode skills also log each run's start and end
to the project's activity log; without it they skip that step. The delegate skills run only the
CLI you have installed (`codex`, `agy`, `opencode` or `claude`), under that CLI's own login,
and need Node.js. Mission Control does not read those CLIs' keys or settings.

## What it does on your machine

### Network

Mission Control sends nothing over the network: no telemetry, no analytics, no calls to any
server. `/standup` and `/handoff` give today's log, and `/ship` gives the branch's commits
and the tickets or GitHub issues they name, to the session's own model through Claude Code's connection, the same way a
prompt you type is sent. The `www.w3.org` address in the code is the SVG namespace used to
draw the panel; nothing is fetched from it.

### Programs it runs

Only `git`, with fixed read-only commands:
- For the status line, every 15 seconds in the session's folder: `git status --porcelain=v2
  --branch`, `git rev-parse --git-dir --git-common-dir`, `git stash list` and `git log -1`.
- For a running delegation, in that delegation's folder: `git -C <folder> rev-parse
  --abbrev-ref HEAD` when it starts, then `git -C <folder> diff --shortstat` every 20
  seconds. The folder is the one the delegate command was given.
- On `/ship`: `git rev-parse`, `git log`, `git rev-list --count` and `git diff --shortstat`
  between the base branch and `HEAD`, in the session's folder (a worktree ships its own branch).

It never merges, pushes or opens a pull request. Buttons for those put the request in the
prompt, and nothing happens until you send it.

### Agents and tools it starts itself

Only when you press a button in the panel:
- **Retry** starts a new sub-agent with the same prompt, description and type the original
  one had. It gives the agent nothing else: no file contents and no conversation.
- **Stop** calls the `TaskStop` tool for that agent.
- **Send note** sends the text you typed to that agent.

### Hooks and what they change

- **Starting a sub-agent** (`agent.spawn`): records the agent for the panel. Two settings can
  change the start:
  - **Settings › Agents and models** (off until you set it): if you set a default model for
    a role and the call did not choose a model, the new sub-agent starts with that model.
  - **Budget** (on by default, at 90% of your plan's 5-hour or weekly window, or $5 a day without
    them; change it with
    `/budget` or turn it off in Settings): when the limit is reached, a new sub-agent does
    not start, and the reason is shown. Agents that are already running are never stopped
    by the budget.
- **Tool calls** (`tool.call`): watched to show what each agent is doing; every call is
  passed on unchanged. The one exception is the plugin's own `step` tool, which sub-agents
  call to report progress: the plugin answers it itself, and it only updates the panel.
  Bash and PowerShell calls are read to spot delegate commands.
- **Prompts** (`prompt.submit`): the prompt you send is shown as the main session's mission
  in the panel. The prompt is passed on unchanged.
- **Commands** (`command.run`): answers only its own commands, the five above. Other
  commands are not touched.
- It reads the number of turns in the session for the status line, never their text.

What it shows is kept in Claude Code's plugin store on your machine and is never sent
anywhere.

### Files it reads

- `.ops/` in the current repository (tickets, activity log, decisions, run stats) for Board
  and Delegations, and the `.md` and `.yml` files under it for `/ship`.
- Mission Control's GitHub cache, `<mission-control>/.cache/github-tasks.json`, and its
  `mc.config.json`, from the folder `MC_DIR` names, the one holding the script `MC_RUN_LOG`
  names, or a `mission-control` folder beside the repository. It is used only when it belongs
  to this repository (its GitHub repo is the `origin` remote, or, with no remote, its
  `appDir` is this repository). Mission Control fetches it; this mod never calls GitHub.
  Turn it off in **Settings › Panel › Board reads**.
- The delegate relays' `result.json` files in your temp folder (`delegate-relay` folders),
  and the brief files given to them.
- Claude Code's plugin records in `~/.claude` (`settings.json`,
  `plugins/installed_plugins.json`, `plugins/known_marketplaces.json` and the marketplaces'
  `marketplace.json`), to show which Mission Mods are installed and enabled in Info.
- Environment variables, for folder locations only: `USERPROFILE`, `HOME`,
  `CLAUDE_CONFIG_DIR`, `TMPDIR`, `TEMP`, `TMP`, `MC_DIR` and `MC_RUN_LOG`. It reads no keys,
  tokens or passwords.

### Files it writes

Only the companion skills: when a session starts it copies any of the five that are missing
into `~/.claude/skills/<skill>` (or `$CLAUDE_CONFIG_DIR/skills/<skill>`), with a small
`.mission-control.json` marker in each folder it creates. These are instruction files that
Claude reads when a skill is used. A skill folder you already have is never touched. Turn
this off in **Settings › Panel › Install companion skills**.

Its own settings, the day log, handoff notes and spend counters are kept in Claude Code's
plugin store, not in your repository.

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Ahmed Essam Mohamed Elhabiby
([@aessamm](https://github.com/aessamm)).
