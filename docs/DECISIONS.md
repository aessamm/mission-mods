# Decisions

Append-only. "Sup, owner asleep" marks a decision the supervisor made while the owner was away;
each one is in the next wake-up report.

| ID | Date | Decision | Who |
|---|---|---|---|
| D-001 | 2026-10-20 | The Board reads GitHub issues from Mission Control's cache (`<mission-control>/.cache/github-tasks.json`) when it belongs to this repo, else `.ops/tickets`; the mod never calls GitHub itself (0.10.0). | Owner |
| D-002 | 2026-10-22 | Next features: start an issue from the board (#1), waiting-on-you inbox (#2), suggest moving the card after a run (#3), built in parallel sessions; then wave 2: #5 scorecard, #6 rate-limit guard, #7 worktrees view. | Owner |
| D-003 | 2026-10-22 | Tasks live in GitHub Issues on `aessamm/mission-mods` with board project 5 (copied from Agenca's); commits reference an issue or say `no-issue`, enforced by `.githooks/commit-msg`. | Sup, owner asleep (owner invoked board-supervisor) |
| D-004 | 2026-10-22 | The supervisor lands each feature branch on `main` after its own review and gates, then releases 0.11.0: push `main` and update the installed plugin, as approved for 0.10.0. No directory resubmission (`SUBMISSION.md` untouched). | Sup, owner asleep |
| D-005 | 2026-10-22 | Card moves are never done by the mod: the #3 buttons fill the composer, the person (or Claude) sends it. | Sup, owner asleep |
| D-006 | 2026-10-22 | The parent's own start on #1 was dropped once the #1 session restarted with the same task; it was saved as a patch and in `git stash` and offered to that session, which kept its own version. | Sup, owner asleep |
| D-007 | 2026-10-22 | Test timeouts at 5 s while several sessions run are CPU load, not code faults; a branch lands only after its suite passes on a quiet run. | Sup, owner asleep |
