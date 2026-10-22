# Changelog

## mission-control 0.14.1 — passes the directory's check again

- No .tsx file uses `h` (what JSX compiles to) as a name of its own any more; the
  plugin directory's check blocked 0.14.0 on it. Nothing changes in what the mod does (#22).

## mission-control 0.14.0 — board-supervisor for everyone

- A sixth companion skill, `board-supervisor`: run a project from GitHub Issues and a live
  project board, with side sessions doing the work in their own worktrees and the supervisor
  re-checking and landing it, a decisions log, and owner-action issues for what only you can
  do. Its `setup-board.sh` creates the board and its Status columns, and `board-cache.mjs`
  keeps the Board tab in step. It replies in the language your project names, else yours (#20).
- `/supervise [text]` starts it, and an empty Board in a GitHub repo offers **Set up a board**;
  Help lists both (#21).

## mission-control 0.13.0 — the week for the client, the time per issue

- `/weekly [days]`: a client update for the last 7 days (or the days given), in Arabic and
  English, from the issues closed and in progress or waiting on the client, the commits and
  the day logs; the session's model drafts it, with a plain fallback, in a card with an Arabic /
  English switch to copy from. Nothing is sent (#17).
- Board: a picked ticket's row shows the time its run-log runs took so far, with runs per
  implementer (#19).
- Tests: session and pane tests get 30 s, so a busy machine no longer fails them (#16).

## mission-control 0.12.0 — know your team, your branches and what changed

- What's new: Info shows the mod's own version, what changed in it and the earlier releases;
  after an update, one toast names the new version. The changelog now ships inside the mod (#14).
- Worktrees tab: every worktree of the repo with its branch, the issue it names, last commit,
  uncommitted changes and push state; buttons to review and land, remove or open one (#7).
- Board: a scorecard per implementer from the last 7 days of Mission Control's run-log, beside
  the `.ops/runs` stats (#5); latest decisions also from a `D-###` table and
  `docs/DECISIONS.md` (#10); the repo's own `.claude/board-cache.json` as a GitHub source when
  there is no Mission Control (#11).
- Delegations: a relay starting for an implementer that hit a rate limit in the last hour gets
  a toast and a note naming a free one, and the Board's Start row warns too (#6).
- `scripts/board-cache.mjs` (in the Mission Mods repo): writes a repo's issues and board
  Status to `.claude/board-cache.json` through `gh`, for the Board to read (#12).

## mission-control 0.11.0 — act from the board

- Board: pick a ticket that is not done; **Start** fills the composer with a delegation
  request for it (Codex, or another Claude when Settings › Agents and models › Builder names
  a Claude model; GitHub issues get run-log `--issue N`), **Open** links to the issue (#1).
- Waiting on you: rows under the status line for GitHub issues in Waiting on owner, runs
  waiting for review and failed runs, each with a button that fills the composer, and a toast
  when an owner issue appears. Settings › Panel › Waiting on you turns it off (#2).
- Delegations: a finished run whose GitHub card is behind offers "Move #N to Review" (or Done
  once marked merged), a confirm-first request in the composer; **Sync board** offers
  Mission Control's `board-sync.mjs --dry-run`. The mod still moves nothing itself (#3).

## mission-control 0.10.0 — GitHub issues, Mission Control's new log

- Board: when a Mission Control folder (`MC_DIR`, the one holding `MC_RUN_LOG`'s script, or
  `mission-control` beside the repo) has cached this repo's GitHub issues, the board shows
  them in the project board's columns, with a new Waiting on owner section, labels, and a
  note when the cache is stale. Otherwise it reads `.ops/tickets` as before.
  **Settings › Panel › Board reads** can keep it on `.ops` only.
- Activity log: reads object details, GitHub issue numbers (`#28`), backfill lines and
  Mission Control's run-log lines; Claude Code hook lines in a row (session started, ended,
  subagent stopped) fold into one row.
- Delegations: a run wrapped by `run-log.mjs --issue N`, or a brief naming `#N`, shows as
  `#N`; finished runs that run-log recorded today appear from any session, titled from the
  board, without doubling a run this session followed live.
- `/ship`: with a GitHub board, lists the issues the branch's commits name with their board
  column, and warns about ones not yet in Review or Done. Git now runs in the session's
  folder, so a linked worktree ships its own branch.
- `/standup`: Waiting on owner issues are listed under Blocked.
- Companion skills: codex-, agy- and opencode-delegate call Mission Control's `run-log.mjs`
  around a run when `MC_RUN_LOG` is set.

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
