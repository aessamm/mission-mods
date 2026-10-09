# Skills strategy — lean, layered, per-ticket

## Why fewer skills

Three costs, all paid on **every run of every agent**:
1. Index: each skill's name+description is loaded at session start (~60–120 tokens each).
   45 skills ≈ 3–5K tokens per run; on a quota-limited plan that is real money/time.
2. Load: an opened SKILL.md is 1–5K tokens, references can be 10K+.
3. Contradiction: three visual-direction skills or four review skills make the agent hesitate
   or satisfy both. This is the expensive one.

Target: **~10–12 skills in the repo**, each ticket names **2–3**.

## Three layers

| Layer | Lives in | Costs implementers | Rule |
|---|---|---|---|
| External | repo (pinned copy) | yes | Only when an authoritative author wrote it better than you would: framework creators (e.g. Fastify by its maintainer, Vitest by its maintainer), official vendor guides, or very large verified install counts. |
| Supervisor (yours) | `~/.claude/skills`, plugins | **no** | Delegate skills, clean-code / test / docs guards, design critique, accessibility review, dataviz, code-review, verification-before-completion. Used once in Foundations: to-tickets, domain-modeling, ADR, security hardening. |
| Project (`<prefix>-*`) | repo `.claude/skills` | yes | The ones that matter. Anything you correct an agent on twice becomes a rule here. Each < 300 lines; long detail in `references/`. |

Everything else (zod patterns, queue patterns, commit format, "no placeholders", shadcn
setup, issue workflow…) becomes **short sections in `AGENTS.md` / `docs/conventions/`**,
loaded once, not as separate skills.

## How to find and vet external skills

```
npx skills find "<topic>"        # skills.sh registry, shows installs
npx skills add <owner/repo@skill> # install; pin by committing the copy into the repo
npx skills check                  # monthly
```
Vet: author reputation (framework maintainers, official orgs) > install count (prefer
1K+, treat <500 as "read and absorb, don't install") > audit badges. Read any skill under
~500 installs yourself and fold the useful parts into a project skill.

Install into every agent's skill directory (`.claude/skills`, Codex's `.codex`/`.agents`
skills dir, `.opencode/skills`, Antigravity's) — the skills CLI supports multiple agent
targets; confirm exact paths in the scaffold ticket.

## Typical project skill set (rename prefix per project)

| Skill | Absorbs | Used by | When |
|---|---|---|---|
| `<p>-tenancy-rules` | multi-tenant architecture/safety checklists, RLS essentials | main implementer; supervisor review | any DB/repository/tool ticket |
| `<p>-domain-math` | exact metric/money definitions, unavailable rules, fixtures | main implementer | analytics tickets |
| `<p>-agent-platform` | tool contract, untrusted-content rules, output validation, agent SDK notes | main implementer | agent/tool tickets |
| `<p>-<integration>-adapter` | what the spike learned: pagination, limits, quirks | main implementer | integration tickets |
| `<p>-ux-principles` | personas, principles, patterns, accessibility + copy checklist | helpers, supervisor | every UI ticket |
| `<p>-ops-logging` | exact schemas for activity.jsonl / runs / DECISIONS | supervisor, helpers | every ops event |

Typical external keepers: backend framework best-practices (by maintainer), ORM patterns,
test runner (by maintainer), web framework router patterns, a single web-design baseline,
E2E best practices (helper doing E2E only).

## Per-ticket loading

Ticket frontmatter `skills: [...]` (max 3). The brief says "read these skills and nothing
else". `AGENTS.md` (< 150 lines) carries a table *ticket type → skills* so agents don't guess.
