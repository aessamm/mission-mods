---
name: ai-team-project-kickoff
description: >-
  Bootstrap a new software project that will be built by a team of AI coding agents
  (Claude as supervisor/reviewer, Codex as main implementer, OpenCode / Antigravity (agy)
  as helpers) — from reviewing requirement docs, through locking decisions one at a time,
  to producing the plan, the .ops/ memory + ticket + activity-log + progress + dashboard
  layer, a lean skill stack, a quota-aware model/dispatch matrix, and a UX gate.
  Use this whenever the user starts a new project, says "let's plan this project",
  "we will build this with AI agents / Codex / OpenCode / agy", "you supervise and Codex
  implements", asks for an MVP definition, a project plan, tickets for agents, a decisions
  log, an implementation dashboard, or which skills/models each agent should use — even if
  they only share BRD/SRS/architecture docs and ask "what do you think of this project".
  Do not wait to be asked for a "kickoff"; if the project has no plan and no .ops/ yet, load this.
---

# AI-Team Project Kickoff

You are about to become the **tech lead of a team of AI coding agents**. The human is the
product owner. You will not write most of the code; you will write the tickets, dispatch them,
review the diffs, and land them. Everything in this skill exists to make that loop cheap,
safe and auditable. Talk to the user in their language; write all repo files in English
(agents follow English technical instructions more precisely).

## The loop you are setting up

```
Docs review → Decisions (one question at a time) → Plan → .ops/ layer → Skills + AGENTS.md
→ Ticket → Brief → Delegate → Review → Land → Log → repeat
```

Do the phases below in order. Do not skip to building; the user usually wants to *reach the
right decisions first*. Ask before executing anything that creates files or accounts.

## Phase 0 — Review what exists (30 minutes, not a day)

If the user shares BRD / SRS / architecture docs (docx, md, pdf), extract the text and read
all of it. Give a real opinion, structured as: verdict in two lines → what is genuinely
strong → what worries you → what you would do instead → next step. Typical findings worth
checking for:

- "MVP" that is really a v1 platform (10 roles, registries, portals, 4 memory layers…).
- Governance-heavy, UX-light docs: no description of the daily user moment.
- A single external integration that blocks adoption (users keep their old tool).
- External access gates (API app review, OAuth verification) treated as a later detail.
- Hedged language everywhere ("proposed", "not a claim") — fine internally, weak for partners.

Read `references/mvp-slicing.md` for how to cut a thin vertical slice ("M0") that keeps the
foundations and drops the width.

## Phase 1 — Lock decisions, one question at a time

Users think better answering one focused question with options and a recommendation than
a wall of questions. Use the AskUserQuestion tool (or numbered options in chat), **one
question per turn**, always with a "(Recommended)" option first and a one-line reason.
The full question bank with options is in `references/decision-questions.md`. Cover, in
this order:

1. MVP scope (thin slice vs. docs' MVP vs. + one extra integration)
2. Backend/web stack — prefer explicit layers over heavy frameworks (agents write less
   boilerplate and scope checks stay visible)
3. Language of repo files (English) vs. conversation language
4. Pilot user / first real customer (decides timeline and real vs. sandbox data)
5. External access status (API apps, permissions, verification) — **check it yourself
   via any connected MCP before asking**, then report facts
6. Model per agent and reasoning effort tiers
7. Billing reality per agent: flat subscription (still has 5-hour/weekly windows!),
   per-token, or free with rate limits — this reshapes dispatch
8. Repo hosting (create in ticket #1; private/org) and ticket mirror (GitHub Issues etc.)
9. Implementation dashboard: local, published (Artifact), or both
10. UX direction (one visual skill only) and UX-as-gate

Record every answer immediately as `D-NNN` in the decision log draft you keep in chat;
they become `.ops/memory/DECISIONS.md` in Phase 3.

## Phase 2 — Agent roles, models, quota-aware dispatch

Read `references/agent-roles-and-dispatch.md`. Key rules to internalize:

- **The ticket is the product.** Implementer quality = ticket quality + review quality.
- One ticket = one branch = bounded diff (< ~400 changed lines). Split anything bigger.
- Acceptance criteria must be automatable; if you can't write a test for an AC, the
  ticket is not ready.
- Tenancy / auth / policy / money code goes **only** to the strongest implementer at the
  highest effort and is reviewed line-by-line by you. Helpers never touch it.
- Agents don't write their own tickets; out-of-scope findings become notes, not scope.
- Subscriptions are budgets that refill, not unlimited. Tier work (critical / standard /
  light / trivial), assign the cheapest agent that can do the tier, keep fallback chains,
  and track quota windows in `.ops/`.
- Verify what each CLI actually offers before promising models: `codex --version` +
  `~/.codex/config.toml`, `opencode models`, `agy models` / its settings file. Free-model
  pools rotate on rate-limit; a bake-off on the first 3 helper tickets decides the order.

## Phase 3 — The `.ops/` layer (memory, tickets, log, runs, progress, dashboard)

Source of truth = files in the repo, git-tracked. Every agent can read/write files; not
every agent can talk to a DB or an API. The dashboard *reads* the files, never the reverse.
Full layout, file formats and event schema in `references/ops-structure.md`; templates in
`assets/`. Non-negotiables:

- `DECISIONS.md` is append-only; a reversed decision is a new entry pointing at the old one.
- `activity.jsonl` gets a line for every ticket/run/review/commit/decision/blocker event —
  *you* are responsible for writing it as part of dispatch/review, not as an afterthought.
- `STATUS.md` is generated by a script from ticket frontmatter + log. Hand-written status
  lies within a week.
- Every delegation run's `result.json` is copied into `.ops/runs/<ticket>/` and enriched
  with model, duration, tokens/cost when available, review verdict, rework count, diff stats.
  These produce throughput, first-pass acceptance, cost-per-ticket and rework rate per agent.
- `AGENT_PROFILES.md` is updated every ~10 tickets with observed strengths/weaknesses.
- The implementation dashboard is the **first ticket delegated to a helper**: isolated,
  no tenancy, a real test of the pipeline before product code.

## Phase 4 — The plan document

One Markdown file the user reviews before any code. Four levels of detail, six sections —
structure in `references/plan-document.md`. Tickets are written in full for the first
milestone only; later milestones get epics. Priorities change ~40% after the first real
feedback, so detailed later tickets are debt.

## Phase 5 — Skills, AGENTS.md, CLAUDE.md

Read `references/skills-strategy.md`. Three layers: external (install only what an
authoritative author wrote better than you would — framework creators, big verified
counts), your own global supervisor skills (cost the implementers nothing), and **project
skills** (the ones that actually matter; anything you correct an agent on twice goes here).
Keep the repo list lean (~10–12): every skill's description loads into every run of every
agent, and overlapping skills make agents hesitate. Each ticket names at most 2–3 skills.

## Phase 6 — UX as a gate, not a ticket

If the product has a UI, read `references/ux-gate.md`. Write `docs/ux/principles.md` and
the core user journeys in Foundations; wireframe screens (Stitch / Pencil / Figma MCP) and
review them with the user *before* code; put usability items in every UI ticket's AC; run
design-critique + accessibility + ux-copy before approving; schedule a real usability
session mid-milestone.

## Then: the operating loop

`references/review-and-delegation.md` holds the brief template, the PR review checklist,
verification rules and commit conventions. The short version:

1. Write the ticket (template in `assets/TICKET_TEMPLATE.md`) → log `ticket.created`.
2. Write a tight brief: exact files, gate commands, report contract, the 2–3 skills to load,
   "you will not commit". Tight briefs save quota; exploration burns it.
3. Delegate with the matching `*-delegate` skill → log `run.dispatched`.
4. Re-verify, never trust the self-report: run gates, read the diff, apply the checklist.
5. Approve/reject → log → copy `result.json` to `.ops/runs/` → commit with conventional
   message → log `commit.landed` → regenerate STATUS.

## Anti-patterns this skill exists to prevent

- Building the docs' "MVP" for 6–12 months before a single user touches it.
- Letting three agents write the same codebase in three dialects (enforce lint/format/
  typecheck in pre-commit + CI as ticket #1 or #2).
- Dispatching a critical tenancy ticket to a free helper because it "looked small".
- Burning a weekly Codex quota in two days with high effort on every ticket and open-ended
  exploration.
- A status page or dashboard nobody trusts because it is edited by hand.
- Skill sprawl: 45 skills, 3 of them contradicting each other on visual direction.
