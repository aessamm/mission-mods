# The `.ops/` layer — memory, tickets, activity log, runs, progress, dashboard

Everything about *building* the product (not the product itself). Git-tracked. Files are the
source of truth; the dashboard reads them. Templates for the files marked (T) live in
`../assets/`.

```
<repo>/
├── CLAUDE.md                  ← entry point for Claude: stack, commands, rules, what to read first
├── AGENTS.md                  ← same content for Codex / OpenCode / agy (they read this name)  (T)
├── docs/
│   ├── 00_roadmap.md
│   ├── 01_brd.md 02_srs.md 03_architecture.md   ← source docs converted to Markdown
│   ├── adr/                   ← big architectural decisions, one file each
│   ├── domain/                ← glossary, tenancy model, metric definitions, state machines
│   ├── conventions/           ← code style, testing, git, error codes, API patterns
│   └── ux/                    ← principles.md, journeys/, tokens.md (if the product has a UI)
├── .ops/
│   ├── memory/
│   │   ├── DECISIONS.md       ← append-only D-NNN log                                    (T)
│   │   ├── LEARNINGS.md       ← things learned the hard way (API quirks, agent habits)
│   │   ├── GLOSSARY.md
│   │   ├── AGENT_PROFILES.md  ← observed strengths/weaknesses per agent+model, updated ~every 10 tickets
│   │   ├── MODEL_POLICY.md    ← model matrix, tiers, fallback chains, verified-on dates
│   │   └── QUOTA.md           ← known windows/resets per agent
│   ├── tickets/
│   │   ├── TEMPLATE.md                                                                  (T)
│   │   └── M0/ M0-001-repo-scaffold.md …     ← one file per ticket, frontmatter = state
│   ├── log/activity.jsonl     ← append-only event stream                                (schema below)
│   ├── runs/<TICKET>/<agent>-<ISO-ts>.json   ← enriched copy of each delegation result.json
│   ├── progress/STATUS.md     ← GENERATED (npm run ops:status); never hand-edited
│   └── dashboard/             ← local static app (npm run ops:dashboard); optionally published as an Artifact
├── .claude/skills/            ← project skills (<project>-* style) + pinned external skills
└── apps/ packages/ …
```

## Ticket frontmatter

```yaml
---
id: M0-007
title: Scoped repository base with RLS context
epic: tenancy
milestone: M0
tier: critical            # critical | standard | light | trivial
status: todo              # todo | ready | in_progress | in_review | rework | done | blocked
assignee: codex           # codex | agy | opencode | claude
model: gpt-x / high       # filled at dispatch
depends_on: [M0-003, M0-004]
skills: [<project>-tenancy-rules, drizzle-orm-patterns]
estimate: M               # S | M | L (L must be split)
github_issue: 12          # mirror id, if mirrored
---
```

Body: Context → Scope (files to touch / not touch) → Acceptance criteria (numbered,
automatable) → Gate commands → Out of scope → Notes from implementer (filled after run).

## activity.jsonl — one JSON object per line

```json
{"ts":"2026-09-22T10:14:03Z","actor":"claude","ticket":"M0-007","event":"run.dispatched","detail":"codex gpt-x/high","ref":".ops/runs/M0-007/codex-2026-09-22T10-14.json"}
```

Event vocabulary (keep it closed; add to it via a decision):
`ticket.created` `ticket.updated` `ticket.status_changed` `run.dispatched` `run.completed`
`run.failed` `run.rate_limited` `review.approved` `review.rejected` `commit.landed`
`decision.recorded` `blocker.raised` `blocker.resolved` `milestone.reached`

The supervisor writes these lines as part of dispatch and review — a `run.dispatched`
line goes in the same step as the delegate call, not "later".

## Run record (`.ops/runs/<TICKET>/<agent>-<ts>.json`)

Copy of the delegate skill's `result.json` plus:

```json
{
  "ticket": "M0-007", "agent": "codex", "model": "gpt-x", "effort": "high",
  "startedAt": "...", "finishedAt": "...", "durationSec": 412,
  "tokensIn": null, "tokensOut": null, "costUsd": null,     // fill when the CLI exposes them
  "rateLimited": false, "status": "completed",
  "reviewVerdict": "approved_with_fixes",                   // approved | approved_with_fixes | rejected
  "reworkCount": 1, "diff": {"files": 6, "added": 210, "removed": 14},
  "session": "<thread id for resume>"
}
```

Derived per agent/model: throughput (tickets/day), first-pass acceptance rate, rework rate,
avg duration, cost per ticket, rate-limit frequency. These decide who gets what.

## DECISIONS.md entry

```
## D-014 — Free-model pool rotates on rate limit (2026-09-21)
Context: OpenCode has no paid plan; several free providers with unknown limits.
Decision: Tier A/B/C pool, rotate on 429/provider error, bake-off on first 3 helper tickets.
Alternatives rejected: single free model (outages block work); paid provider (cost).
Decided by: user + supervisor.  Supersedes: —
```

Append-only. Reversal = new entry with `Supersedes: D-014`.

## STATUS.md (generated)

Milestone → epics with done/total and % → tickets by status → blockers → agent summary
(last 7 days: runs, acceptance, rework, rate limits) → last 20 activity lines.
Generator: a small Node script reading ticket frontmatter + activity.jsonl + runs/.

## Dashboard

Static local app (Vite + React or a single HTML file) fed by a generated `ops-data.json`.
Views: Kanban by epic/status/assignee · burn-up per milestone · activity feed · agents panel
(runs, acceptance, cost, avg time, quota window, last run status) · blockers · decisions
timeline. No backend, DB or auth. Optional publish as an Artifact for mobile viewing.
It is the **first helper ticket**: isolated, no tenancy, exercises the whole pipeline.

## GitHub Issues mirror (optional)

One-way from ticket files → issues (create on `ticket.created`, close on `done`), with the
issue id written back into frontmatter. The Markdown file remains the source of truth.
