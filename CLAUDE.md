# Mission Mods

A Claude Code marketplace (`.claude-plugin/marketplace.json`) with one mod so far,
`mission-control/` (hooks module mod: `hooks/`, `types/`, `tests/`, `bundled-skills/`).

## Start of every session

0. Read the board. GitHub Issues on `aessamm/mission-mods` are the single source of truth for
   tasks. Every work item needs an issue before work starts; commits reference it (`#123`) or
   say `no-issue` (enforced by `.githooks/commit-msg`; run `git config core.hooksPath .githooks`
   once per clone). Move the card when the work moves, in the same step.
   Board: project 5 (https://github.com/users/aessamm/projects/5), id PVT_kwHOARAs4c4BoK5m,
   Status field PVTSSF_lAHOARAs4c4BoK5mzhmsOIM, Backlog 9315c413, Todo 4fa28133,
   In progress c765498a, Review 7702c599, Waiting on owner a07e38a0, Done 9da68047
1. Decisions log: `docs/DECISIONS.md`.
2. `git status`, `git worktree list`.

Owner ↔ supervisor discussion is in Egyptian Arabic; every file in the repo is English.

## Working on the mod

- Load the `plugin-authoring` skill before changing anything under `mission-control/`.
- Gates: `claude plugin validate mission-control`, `claude plugin validate .`,
  `claude plugin test mission-control`, `node --test scripts/check-commit-msg.test.mjs`.
- A test that times out is not proven to be load: a timeout hid a real render error in #14.
  Rerun that file alone with `{ timeoutMs: 60_000 }` and see it pass or show its real error.
- The mod never calls GitHub or `gh` and never runs git writes; its buttons fill the composer.
- `$.env.get` takes a literal name. In tests the host resolves mocked paths against its own
  drive: match mock paths on the tail. Files are CRLF on Windows; write them with an editor,
  not shell heredocs (they drop backslashes).
- A change to a file under `bundled-skills/<skill>/` needs that skill's `hash` in
  `bundled-skills/manifest.json` updated: sha256 over each listed file's name then its bytes,
  first 12 hex characters.
- Every change that alters what the mod does, shows, reads or runs lands with its updates to
  both READMEs (root `README.md` and `mission-control/README.md`) and
  `mission-control/CHANGELOG.md`, in the
  same landing. Side sessions leave those files to the supervisor, who writes them when landing.
- Release: bump `mission-control/.claude-plugin/plugin.json`, add a
  `## mission-control X.Y.Z — title` entry at the top of `mission-control/CHANGELOG.md` (it
  ships with the mod; Info's What's new reads it, and the root `CHANGELOG.md` only points
  there), update
  both READMEs, push `main`, then `claude plugin marketplace update mission-mods` and
  `claude plugin update mission-control@mission-mods`.
