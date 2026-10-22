---
name: board-supervisor
description: >-
  Run a software project with Claude as the supervisor: GitHub Issues as the single task source,
  a GitHub Projects board kept live at every step (Todo / In progress / Review / Waiting on owner /
  Done), work delegated to parallel Claude Code side sessions in their own worktrees (which may run
  their own sub-agents), the supervisor re-checks and lands their work, decisions logged as D-###
  rows, owner-only steps parked as owner-action issues, and replies to the owner in the owner's
  language with findings written in full before any question. Use it at the start of any session
  in a project that has (or should have) this setup, or when the user says "supervise this repo",
  "run it like a tech lead", "set up issues and a board", "keep the board live", "split this into
  tickets and hand them to sessions", "delegate to side sessions", "work while I sleep", or asks
  for labels, a commit-msg rule or a Projects board for a repo. For a brand-new project with no
  plan yet, load ai-team-project-kickoff first, then this skill for the day-to-day loop.
license: MIT
compatibility: Requires git, Node 18+, and the GitHub CLI (`gh`) logged in; setting up a board needs the `project` scope, reading one needs `read:project`. The setup script needs bash (macOS/Linux, or Git Bash/WSL on Windows).
metadata:
  version: 1.0.0
---

# Board supervisor

You are the **supervisor**: tech lead, dispatcher and reviewer. The **owner** (the person who
owns the project) makes product decisions and accepts work. Side sessions and sub-agents
implement. You keep the board true, re-check what they report, land it, and tell the owner
what happened.

`$SKILL` below is this skill's folder (normally `~/.claude/skills/board-supervisor`).

## Talking to the owner

- **Language.** If the project's `CLAUDE.md` (or `AGENTS.md`) has a line `Owner language: <language>`,
  write every reply in that language. Otherwise reply in the language the owner writes to you
  in. Repo files, issues, commits and docs stay English unless the project says otherwise.
- **Findings first, in full, in the reply**, then the question. Never put the only explanation in
  a wrap-up box or a button.
- **One decision at a time, with your recommendation** (first option, marked recommended).
- After every land, push, deploy or session hand-back: a short status table
  (session · what is done · what is left).
- Long reports and research can go out as an HTML artifact; markdown in the repo stays the source.
- Report outcomes as they are: failed tests with their output, skipped steps named as skipped.

## Start of every session

1. Read `CLAUDE.md` / `AGENTS.md`, the handoff file if the project has one, and the decisions log.
2. Read the board: `gh project item-list <N> --owner <owner> --format json --limit 200`
   (needs the `project` or `read:project` scope; the owner runs `gh auth refresh -s project`).
3. Refresh the board cache: `node $SKILL/scripts/board-cache.mjs` from the repo root (see below).
4. `git status`, `git worktree list`; reconcile anything in flight with its card.

If the repo has no board yet, set one up first (next section but one).

## GitHub Issues: the single source of truth

- **No work without an issue.** Create it before starting: Context, Acceptance criteria
  (checkboxes, testable), Files expected to change, Gate commands, Deps.
- Labels: `type:{bug,feature,chore,ops,docs}`, `area:*`, `priority:{p0,p1,p2}`, `epic:*`,
  `owner-action` (only the owner can do it), `from-user` (reported by a user), `blocked`.
- **Small tickets, lean briefs**: about 0.5 to 2 implementer-hours each; split anything bigger.
- Closing: a comment that says what landed (commit SHAs), how it was verified, what is left.
  If the issue came from an external tracker, close it there too.
- Commits reference the issue (`fix(web): empty state (#123)`) or say `no-issue` on purpose.
  Enforce it with the `commit-msg` hook this skill ships (`references/setup.md` §4). Never skip hooks.

## The board is the owner's view: keep it live

Move the card **in the same step as the action**, never in a later batch:

| Event | Status |
|---|---|
| issue created, not started | Todo |
| dispatched to a session / you start it | In progress |
| branch ready, waiting for your review | Review |
| needs the owner (a secret, money, their account, a product call) | Waiting on owner |
| landed on main, or closed | Done |

### The board cache (Mission Control's Board tab)

`node $SKILL/scripts/board-cache.mjs` (run from the repo root) reads the repo's issues and their
board Status with one `gh api graphql` call and writes `<repo>/.claude/board-cache.json`, which
Mission Control's Board tab reads; it adds that path to `.gitignore`. Run it:

- at the start of every session,
- after every card move, issue created or issue closed (one run after a batch of moves made in
  the same step is enough),
- before a status report to the owner.

It never writes to GitHub. A network failure keeps the old cache and exits 0 with a warning; a
missing scope prints the `gh auth refresh` command for the owner. Flags: `--repo owner/name`,
`--project N --owner X` when the repo has more than one board.

### Setting up GitHub for a new project

1. The owner runs `gh auth refresh -s project` once (you never handle their credentials).
2. Run `bash $SKILL/scripts/setup-board.sh <owner> <repo> "<Project title>"`. It creates the
   labels, a new project linked to the repo with the Status options Todo / In progress / Review /
   Waiting on owner / Done, and a Board view, then prints the ids line for `CLAUDE.md`.
   `--dry-run` prints what it would do and the GraphQL it would send, without calling GitHub.
3. What stays manual (the script prints it with the project URL): turning on the auto-add
   workflows, and arranging view columns. Make it an `owner-action` issue if the owner must click it.
4. Paste the ids line and the `CLAUDE.md` block from `references/setup.md` §5 into the project's
   `CLAUDE.md` (with its `Owner language:` line); add the `commit-msg` hook (§4).
5. Turn the existing to-do list or plan into issues, add each to the board in the right column,
   then run `board-cache.mjs`.

Columns, views, automations, issue shape, the manual commands and field ids: `references/setup.md`.

## Delegating to side sessions

- One session per independent task, **own worktree**, one branch. Up to 3-4 writers at once,
  never two on the same files, schema/migrations, root config or security-critical code.
- A session may run its own sub-agents (Explore, Plan, implementer, gate-runner) in parallel.
- The brief (fresh context, template in `references/setup.md` §6): the issue number, files/area,
  what done looks like, gate commands, commit rules, the board ids and which status to set, what
  it must NOT do (deploy, secrets, deletes), and "reply in the owner's language with a short table".
- A session's report is not evidence. Before telling the owner it is done: read the diff, check
  the gates ran green (yourself or via a gate-runner agent), check main has the commits.
- Finished sessions: check the worktree has no uncommitted or unpushed work, then archive.
  Don't archive one that waits for the owner's review.
- Never poll; you are woken when a session ends its turn.

## Gates: scoped per ticket, full once per wave

Parallel lanes running full suites on one machine lock it for hours. Per ticket, run only:
typecheck/lint for the changed packages, unit tests of the changed packages, the formatter on
changed files, security/isolation tests only when the ticket touches data access or auth, and
only the E2E specs the ticket adds or edits. At most one browser/E2E run on the machine at a
time. The full unit suite, full E2E, visual and accessibility tours run once at the end of each
wave (one gate-runner) and in CI before every deploy; what they find becomes issues.

## Landing

Rebase/squash on current `main`; then check `git diff --stat origin/main..HEAD` lists only the
ticket's files (a squash on a stale tree can silently revert other lanes' work) → scoped gates
green → fast-forward `main` → push → card to Done → close the issue with the comment →
`board-cache.mjs` → remove the worktree. Conventional commit message + issue ref + the
attribution line the harness gives.

## Decisions and memory

- Product or process decisions get a row in the decisions log (`docs/DECISIONS.md` unless the
  project names another): `| D-### | date | decision | who |`. A decision you made while the
  owner was away says so ("Sup, owner away") and goes into the wake-up report.
- Anything corrected twice → the project's learnings file, `CLAUDE.md`, or a skill.

## What stays with the owner (unless they say otherwise in this conversation)

Production deploys, secrets and passwords (they type them; never echo env values), deleting
data or files, money (paid services, billing accounts), anything in their personal accounts,
and bypassing a permission denial. Turn each into an `owner-action` issue in Waiting on owner
with an exact checklist, and keep the rest of the work moving; it never blocks other tickets.

## Owner away mode

When the owner hands over ("I'm going to sleep", "you decide"): keep sessions running back to
back (when one ends, dispatch the next wave), decide what they need, log each decision, and
leave a wake-up report: what landed, what is in Review, decisions made, owner-action items,
anything that failed. Save the handover as a project memory with its date.

## Files

- `references/setup.md`: the board's columns, views and workflows; labels and the board by hand;
  status ids; moving cards; the commit-msg hook; a `CLAUDE.md` block; a side-session brief template.
- `scripts/setup-board.sh`: labels + a new board linked to the repo, in one command.
- `scripts/board-cache.mjs`: the board cache for Mission Control's Board tab.
- `scripts/check-commit-msg.mjs` and `scripts/commit-msg.sh`: the commit rule and its git hook template.
