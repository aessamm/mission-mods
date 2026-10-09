---
id: M0-000
title: 
epic: 
milestone: M0
tier: standard            # critical | standard | light | trivial
status: todo              # todo | ready | in_progress | in_review | rework | done | blocked
assignee:                 # codex | agy | opencode | claude
model:                    # filled at dispatch, e.g. gpt-x / high
depends_on: []
skills: []                # max 3
estimate: M               # S | M | L (L must be split)
github_issue:
---

## Context
Why this ticket exists, what already exists, which decisions apply (D-NNN).

## Scope
**Touch:** `path/to/file.ts`, `packages/x/**`
**Do not touch:** `packages/policy-engine/**`, migrations outside `db/migrations/`

## Acceptance criteria
1. Given … when … then … (automatable)
2. …

## Gate commands
```
pnpm lint && pnpm typecheck && pnpm test --filter <pkg>
```

## Out of scope
- …

## Implementer notes
(filled by the agent after the run — decisions made, questions, findings out of scope)

## Review log
- YYYY-MM-DD — verdict — reviewer — notes
