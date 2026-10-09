# Agent roles, model matrix, quota-aware dispatch

## Roles

| Role | Who | Does | Does not |
|---|---|---|---|
| Tech lead / reviewer | Claude (you) | Writes tickets with testable AC, writes briefs, delegates, re-verifies, reviews diffs, commits, logs to `.ops/` | Implement large features yourself (only when a critical ticket must not wait for a quota reset) |
| Main implementer | Codex (`codex-delegate`) | Core tickets: domain logic, auth/tenancy, analytics, integrations, agent runtime | Architectural decisions, expanding scope |
| Helper (flat plan) | Antigravity / agy (`agy-delegate`) | Standard and light tickets: features glue, tests, frontend components, mechanical refactors | Tenancy / policy / money code |
| Helper (free pool) | OpenCode (`opencode-delegate`) | Trivial/light: boilerplate, migrations, fixtures, docs, config, the ops dashboard | Anything with security or money |
| Product owner | The user | Decisions, scope, final acceptance | — |

## Ticket tiers → agent → fallback chain

| Tier | What | Primary | Fallback when rate-limited |
|---|---|---|---|
| Critical | tenancy, authz, policy/approval, executor, money math, secrets | Codex strongest model / high | **Wait for reset.** Never a helper. If urgent, you implement it yourself. |
| Standard | domain features, API routes, workers, integration glue | Codex mid model / high **or** agy (whichever has more remaining window) | Codex mid → agy → Codex light → wait |
| Light | UI components, tests for existing code, migrations, docs | agy **or** OpenCode tier A | agy → OpenCode A → OpenCode B |
| Trivial | boilerplate, config, renames, fixtures, ops dashboard | OpenCode tier A | A → B → C |

Label every ticket with its tier in frontmatter. The tier, not the size, decides the agent:
a 30-line change to a scoped repository is Critical.

## Model matrix template (fill with what the CLIs actually expose)

```
Supervisor      : Claude (current session model)
Codex critical  : <strongest model>   / effort high      (~25-30% of tickets)
Codex standard  : <mid model>         / effort high      (~40%)
Codex light     : <light model>       / effort high|med
Codex 2nd mind  : <other-family model>/ effort medium    (plan review + critical PRs only)
agy             : <best available Gemini/Claude label>  (verify with `agy models` or settings)
OpenCode pool   : Tier A [3 models]  Tier B [3-4]  Tier C [rest]  — rotate on rate limit
```

Verify with: `codex --version`, `~/.codex/config.toml`, `opencode models`, `agy models`,
`~/.gemini/antigravity-cli/settings.json`. Note in `.ops/memory/MODEL_POLICY.md` which
model IDs were *verified present* on which date.

## Quota reality

Flat subscriptions (ChatGPT Plus/Pro, Google Pro) refill on 5-hour and weekly windows.
Treat Codex as the most expensive resource you have:

- High effort only on Critical (and Standard when needed); never open-ended exploration.
  The brief lists the exact files and context; Codex must not read the repo to orient.
- Second-mind reviews only on Critical PRs and once on the plan — each call spends quota.
- Sequence tickets so Critical work is spread across days; helpers work in parallel on
  light/trivial while Codex waits for a reset. A typical day: 2–3 Codex + 2–3 agy +
  3–5 OpenCode tickets.
- Every rework round costs quota → tight briefs, real gate commands, no ambiguity.

Track in `.ops/memory/QUOTA.md` (known windows and reset times per agent) and in each run
record (`rateLimited: true`, remaining-window if the CLI exposes it). The dashboard shows
per agent: runs in the current window, last rate-limit, expected reset.

## Free model pool rules (OpenCode)

- Tier A = 3 candidates from a bake-off on the first 3 helper tickets (lint setup, fixtures,
  ops dashboard). Record first-pass acceptance, rework, duration per model in
  `AGENT_PROFILES.md`, then reorder tiers by data, not by reputation.
- On rate-limit / provider error → next model in the tier → next tier.
- Every run records the model actually used so the dashboard can compare models.
- If any paid provider is ever used from OpenCode, record real cost from `result.json`.

## Hard rules

1. One ticket = one branch = bounded diff (< ~400 changed lines). Split otherwise.
2. AC must be automatable. No test possible → ticket not ready.
3. Implementers do not commit; you commit after review. Tell them so in every brief.
4. Implementers do not write tickets or expand scope; they leave notes.
5. Lint + format + typecheck enforced in pre-commit and CI before any feature ticket, or
   three agents will produce three dialects.
6. "Done" means gates ran green **in your shell**, not in the agent's self-report.
