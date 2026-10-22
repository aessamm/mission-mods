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
| D-008 | 2026-10-22 | 0.11.0 released with #1-#3 as soon as they passed a quiet 56/56 run; wave 2 (#5-#7) goes into 0.12.0. | Sup, owner asleep |
| D-009 | 2026-10-22 | Every change lands with its README and CHANGELOG updates, written by the supervisor at landing. | Owner |
| D-010 | 2026-10-22 | The supervisor checks its sessions every 30 minutes when they have not reported and sends the owner a status brief each time. | Owner |
| D-011 | 2026-10-22 | Side sessions here cannot write to the GitHub board (permission denied), so the supervisor moves their cards. | Sup, owner asleep |
| D-012 | 2026-10-22 | board-supervisor in the mod: proposal in `docs/board-supervisor-in-mod.md`; the board pieces (#10-#12) go ahead, shipping a generic public skill (#13) waits for the owner. | Sup, owner asleep |
| D-013 | 2026-10-22 | The version shows in the mod and grows a What's new and Changelog section (#14); the CHANGELOG moves inside the plugin folder so it installs with the mod. | Owner |
| D-014 | 2026-10-22 | 0.12.0 ships #5, #6, #7 and #14 together (and #10 if it is ready), after a quiet full test run. | Sup, owner asleep |
| D-015 | 2026-10-22 | A relay result counts as rate-limited only when the run failed or says so in `rateLimited`; words in a finished run's message do not count. | Sup, owner asleep |
| D-016 | 2026-10-22 | graft's `/graft/` ignore line is committed (it keeps graft's regenerable cache out of git); its `.ignore` file stays untracked. | Sup, owner asleep |
| D-017 | 2026-10-22 | Worktrees is its own tab between Board and Log (the Log hotkey moves from 4 to 5), not a Board section: branches on disk are neither issues nor runs. | Sup, owner asleep |
| D-018 | 2026-10-22 | The 0.12.0 release waits for proof the suite is green: each test file run alone in sequence (or the full suite once #16 gives session and pane tests a 30 s timeout). | Sup, owner asleep |
| D-019 | 2026-10-22 | `mission-control/CHANGELOG.md` is the changelog (it ships with the mod for What's new); the root `CHANGELOG.md` only points to it. | Sup, owner asleep |
| D-020 | 2026-10-22 | At most two sessions work at once while the machine runs at 100% CPU; the others wait idle until the release. | Sup, owner asleep |
| D-021 | 2026-10-22 | D-007 is narrowed: a timeout is called load only after the file passes alone with a 60 s timeout. A timeout had hidden a real Info tab crash (#14, fixed in 907b7d8). | Sup, owner asleep |
| D-022 | 2026-10-22 | Next feature: /weekly, a client update for the week in Arabic and English (#17), from the owner-approved idea list. | Sup, owner asleep |
