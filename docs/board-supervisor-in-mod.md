# Bringing board-supervisor into Mission Control (proposal, 2026-10-22)

The owner's `board-supervisor` skill (`~/.claude/skills/board-supervisor`) runs a project on
GitHub Issues and a Projects board, with side sessions as implementers and the supervisor
landing their work. Mission Control already draws most of that loop (Board, Start, Move card,
inbox, delegations, run-log). This note says how the two fit and what to build.

## What stands in the way today

1. **The skill is personal.** It speaks Egyptian Arabic to "Ahmed", copies the private Agenca
   board (`aessamm/projects/3`) as its template, and names Agenca's paths. A public user can't
   copy a private project they don't own, and the voice and names are wrong for them.
2. **The Board only sees GitHub through Mission Control.** It reads
   `<mission-control>/.cache/github-tasks.json`. A board-supervisor project without a Mission
   Control folder, like this repo, gets an empty Board even though its issues and board exist.
3. **Decisions don't show.** The Board reads `## D-014 — title (date)` headings from
   `.ops/memory/DECISIONS.md`; board-supervisor writes a `| D-### | date | decision | who |`
   table, here in `docs/DECISIONS.md`.

## Proposal

| # | Piece | Where | Size |
|---|---|---|---|
| A | A public, generic `board-supervisor` companion skill: same loop, no names. The owner's language comes from the project (`CLAUDE.md`: "Owner language: …", default the user's own); the board is created by the script (Status options set through GraphQL) instead of copied from Agenca; Agenca stays an example only. Shipped in `bundled-skills/` with its manifest hash. The owner's own copy has no Mission Control marker, so the mod never overwrites it. | `bundled-skills/board-supervisor/` | M |
| B | `board-cache.mjs`, shipped with the skill: one `gh api graphql` call writes the repo's issues and board Status to `<repo>/.claude/board-cache.json` in Mission Control's `mc.github-tasks.v1` shape. The skill runs it at session start and after every card move; the mod never calls GitHub (its rule stays). | skill `scripts/` | S |
| C | The Board reads `<repo>/.claude/board-cache.json` as a third source (after Mission Control's cache, before `.ops/tickets`), with the same stale note. | `board.tsx` | S |
| D | Decisions: parse both the heading and the table form, from `.ops/memory/DECISIONS.md` and `docs/DECISIONS.md`. | `board.tsx` | S |
| E | Entry points: `/supervise` fills the composer with `/board-supervisor`; the Board's empty state in a GitHub repo with no board offers "Set up a board"; Help lists the skill. | `register.tsx`, `help.tsx`, `board.tsx` | S |

Order: D and C first (useful at once, no product question), then B, then A and E together as
0.12.0. A is the owner's call because it publishes his way of working under the mod.

## Open questions for the owner

1. Ship a generic public `board-supervisor` in the mod (recommended), or keep it personal and
   only do B–E?
2. Default language when a project says nothing: the user's own (recommended) or English?
