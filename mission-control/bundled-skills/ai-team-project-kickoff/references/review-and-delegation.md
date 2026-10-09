# Brief writing, delegation, review, landing

## Brief (what you send to an implementer)

Use the delegate skill's brief format; make sure it contains:

```
Ticket: M0-007 — <title>            Tier: critical      Model/effort: <as decided>
Read first: AGENTS.md, .ops/memory/DECISIONS.md (D-003, D-007), skills: [<2-3 names>]
Context: <3-6 lines: why this exists, what already exists, what it connects to>
Files to change: <exact paths>          Files NOT to touch: <paths / packages>
Do:
  1. ...
  2. ...
Acceptance criteria: <copied from ticket, numbered>
Gate commands (must pass): pnpm lint && pnpm typecheck && pnpm test --filter <pkg>
Constraints: no new dependencies without noting why; no placeholders/TODOs; keep diff < 400 lines;
             do NOT commit; do NOT expand scope — leave notes under "Implementer notes".
Report contract: summary, files changed, gates run + output tail, open questions, decisions you made.
```

Why tight: every line the agent has to discover itself is quota spent and a chance to
wander. Why "no commit": you are the reviewer of record; the audit trail is yours.

Log `run.dispatched` in `activity.jsonl` in the same step as the delegate call.

## When the run finishes

1. `result.json` exists with a status and the process exited — only then is it done.
2. Copy it to `.ops/runs/<TICKET>/<agent>-<ts>.json`; add model/effort/duration/rateLimited.
3. **Re-verify in your shell**: run the gate commands yourself; read the full diff.
4. Review checklist (in order — the first failing item is the verdict):
   - Scope: only the listed files; no scope creep; diff size bounded.
   - Tenancy / security (if applicable): every query scoped; no model-supplied IDs treated
     as authority; no secrets in code/logs; no new external calls.
   - Correctness: AC satisfied with tests that actually assert behaviour (use test-guard
     on any test file — helpers produce test bloat).
   - Clean code: clean-code-guard on production code; no placeholders; no duplicated helpers.
   - UX (if UI): the ux-gate checklist.
   - Docs: any changed behaviour reflected in docs (docs-guard).
   - Implementer notes: read them; surface their decisions to the user if non-trivial.
5. Verdict → log `review.approved` / `review.rejected`, update run record
   (`reviewVerdict`, `reworkCount`), update ticket status.
6. Rejected → delta brief with the session id (cheaper than a fresh run), not a new brief.

## Landing

- Conventional commit: `feat(tenancy): scoped repository base with RLS context (M0-007)`,
  body lists AC verified, trailer lines per the session's attribution rules.
- Log `commit.landed` with the SHA; regenerate STATUS; mirror to the issue tracker if used.
- Every ~10 tickets: update `AGENT_PROFILES.md` and reorder model tiers from data.

## Verification before "done" (borrowed from verification-before-completion)

Never report a ticket done from an agent's summary. Evidence = gate output you ran + diff
you read + AC you checked. If a gate cannot run (missing service, no credentials), say so
explicitly and mark the ticket `in_review` with a blocker, not `done`.
