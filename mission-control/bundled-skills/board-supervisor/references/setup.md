# Setup and commands

`$SKILL` is this skill's folder (normally `~/.claude/skills/board-supervisor`).

## 0. What the board looks like

A GitHub Projects (v2) board owned by the repo owner (a user or an organization) and linked to
the repo.

**Status field** (single select, the board's columns):

| Option | Colour | Meaning |
|---|---|---|
| Todo | gray | Not started |
| In progress | yellow | Being worked on |
| Review | blue | Done by the implementer, the supervisor is reviewing |
| Waiting on owner | orange | Needs the owner |
| Done | green | Landed or closed |

A `Backlog` option before Todo is fine for ideas not planned yet; `board-cache.mjs` shows
whatever options the board has.

Other fields are GitHub's built-ins: Assignees, Labels, Linked pull requests, Milestone,
Repository, Reviewers, Parent issue, Sub-issues progress.

**Views:**

| Name | Layout | Shows |
|---|---|---|
| Issues | Table | Title, Assignees, Status, Linked pull requests, Sub-issues progress |
| Board | Board, columns = Status | Title, Assignees, Status, Labels, Linked PRs, Milestone, Parent issue |
| Roadmap (optional) | Roadmap | Title, Assignees, Status, Linked PRs |

**Workflows (built-in automations):** on: Item added to project (Status: Todo), Item closed
(Status: Done), Item reopened (Status: Todo), Auto-add to project (new issues of the repo),
Auto-add sub-issues to project. Off: Auto-close issue, Pull request linked to issue, Pull request
merged (the supervisor lands on main directly; cards are moved by hand in the same step as the
work).

**Issue body shape:** `## Context` (why, source, decision ids) → `## Acceptance criteria`
(checkboxes, testable) → optional `## Files expected to change`, `## Gate commands`, `## Deps`.
Owner-only issues end with an exact numbered checklist of what the owner clicks or types.

## Quick setup: one script

```bash
bash $SKILL/scripts/setup-board.sh <owner> <repo> "<Project title>"
bash $SKILL/scripts/setup-board.sh --dry-run <owner> <repo> "<Project title>"   # prints only
```

What it does through the GitHub GraphQL API, with the owner's own `gh` login:

1. Creates the labels below (`gh label create --force`, safe to re-run).
2. `createProjectV2` with `ownerId` and `repositoryId`: a new project owned by `<owner>`, linked
   to the repo. It stops if the repo already has an open project with that title.
3. `updateProjectV2Field` on the project's Status field: replaces GitHub's default options with
   Todo / In progress / Review / Waiting on owner / Done (`createProjectV2Field` if a project
   ever comes without a Status field).
4. `createProjectV2View` with `BOARD_LAYOUT`: a Board view (it groups by Status). If GitHub
   refuses, the script says so and the view is added by hand.
5. Prints the ids line for `CLAUDE.md` and the manual steps.

**What stays manual** (the API has no mutation for these): turning workflows on
(`<project url>/workflows`: Auto-add to project with `repo:<owner>/<repo> is:issue,pr`,
Auto-add sub-issues, and checking Item closed / Item reopened are on), choosing which fields a
view shows, renaming "View 1" to "Issues", and an optional Roadmap view. If the owner must click
them, make an `owner-action` issue with that checklist.

Sections 1-3 are the manual way.

## 1. Labels (once per repo)

| Label | Colour | Use |
|---|---|---|
| `type:bug` `type:feature` `type:chore` `type:ops` `type:docs` | various | kind of work |
| `area:web` `area:api` `area:infra` `area:ops` | c5def5 | part of the product; add your own |
| `priority:p0` / `p1` / `p2` | b60205 / d93f0b / fbca04 | now / next / later |
| `owner-action` | e99695 | only the owner can act or decide |
| `blocked` | 000000 | waits on another issue or an external step |
| `from-user` | fbca04 | reported by a user |

```bash
R=owner/repo
for l in type:bug type:feature type:chore type:ops type:docs area:web area:api area:infra \
         priority:p0 priority:p1 priority:p2 owner-action from-user blocked; do
  gh label create "$l" -R $R --force
done
```

## 2. Projects board by hand

The owner runs `gh auth refresh -s project` first.

```bash
gh project create --owner <owner> --title "<Project>"          # note the number N
gh project link N --owner <owner> --repo <repo>
gh project field-list N --owner <owner> --format json           # Status field id + option ids
gh project view N --owner <owner> --format json --jq .id        # project id
```

Set the Status options to Todo, In progress, Review, Waiting on owner, Done (web UI: the
project's settings → Status), then write the ids into the project's `CLAUDE.md`:

```
Board: project N (<url>), id PVT_..., Status field PVTSSF_..., Todo <id>, In progress <id>,
Review <id>, Waiting on owner <id>, Done <id>
```

## 3. Moving a card

```bash
P=PVT_xxx; F=PVTSSF_xxx
id=$(gh project item-add N --owner <owner> --url https://github.com/<owner>/<repo>/issues/123 --format json --jq .id)
gh project item-edit --project-id $P --id $id --field-id $F --single-select-option-id <status-option-id>
node $SKILL/scripts/board-cache.mjs     # refresh Mission Control's Board
```

`item-add` is idempotent: it returns the existing item id for an issue already on the board.

Open cards: `gh project item-list N --owner <owner> --format json --limit 200 --jq '.items[] | select(.status != "Done") | "\(.status) | #\(.content.number) \(.title)"'`

## 4. commit-msg hook

`$SKILL/scripts/check-commit-msg.mjs` accepts a message with `#123` / `owner/repo#123`, or the
word `no-issue`, and lets git's own `Merge` / `Revert` / `fixup!` / `squash!` / `amend!`
messages through; otherwise it prints the usage and exits 1. Install it in the repo, so every
clone has it:

```bash
mkdir -p .githooks scripts
cp $SKILL/scripts/commit-msg.sh .githooks/commit-msg
cp $SKILL/scripts/check-commit-msg.mjs scripts/
git config core.hooksPath .githooks        # once per clone; say so in CLAUDE.md
```

Add `.githooks/* text eol=lf` to `.gitattributes` so Windows checkouts keep the hook runnable.
With husky instead: `.husky/commit-msg` runs
`node "$(git rev-parse --show-toplevel)/scripts/check-commit-msg.mjs" "$1"`.

## 5. CLAUDE.md block to add to a project

```markdown
Owner language: <the language the owner wants replies in, e.g. English>

## Start of every session
0. Read the board. GitHub Issues on `<owner>/<repo>` are the single source of truth for tasks.
   Board: project N (ids line from setup-board.sh). Every work item needs an issue before work
   starts; commits reference it (`#123`) or say `no-issue` (enforced by `.githooks/commit-msg`;
   run `git config core.hooksPath .githooks` once per clone). Move the card when the work moves,
   in the same step, then refresh the board cache.
1. Decisions log: `docs/DECISIONS.md` (`| D-### | date | decision | who |`).
2. `git status`, `git worktree list`.
Supervisor ↔ owner discussion is in the owner language; every file in the repo is English.
```

## 6. Side-session brief template

```
Do GitHub issue #<n> on `<owner>/<repo>`: <one-line goal>.
Board: project N (project id ..., Status field ..., In progress ..., Review ...,
Waiting on owner ..., Done ...). Card is In progress now.

Files/area: `<paths>`. Done means: <acceptance criteria, numbered>.
Gates: `<exact commands>`. You may run sub-agents for exploration or parallel parts.

Rules: commits reference #<n> and end with the attribution line; never skip hooks; squash onto
current main, fast-forward main and push (or: leave the branch and move the card to Review).
Do NOT deploy, touch secrets, delete data, or spend money; if a step needs the owner, write an
owner-action checklist on the issue, move it to Waiting on owner, and finish the rest.
Reply in <owner language> with a short table: done, verified how, left for the owner.
```

Background for a fresh session: what the product is, where the repo lives, the decisions that
matter for this ticket, and the owner's language for reports.
