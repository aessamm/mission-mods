# The plan document

One Markdown file (`docs/PLAN.md` or `.ops/PLAN.md`) the user reviews before any code.
Write it only after the decisions are locked (Phase 1). Publish it as an Artifact too if
the user wants to read it away from the terminal.

## Sections

1. **Decisions summary** — the D-NNN table (id, decision, one-line why).
2. **Roadmap (Level 0)** — M0 → Mn with exit criteria; what each milestone explicitly
   does *not* include.
3. **Foundations (Level 1)** — monorepo layout, domain modules and ownership, tenancy /
   authorization model, tool and event contracts, conventions (lint, tests, errors, API
   patterns, commit format). These are the things every ticket will assume.
4. **M0 epics and tickets (Level 2 + 3)** — epics with dependencies; tickets in execution
   order, each with tier, assignee, model/effort, skills, estimate, AC summary. Mark the
   "first helper ticket" (ops dashboard) and the "first critical ticket" (scoped
   repositories). Include the external-access spike (API app, permissions) in week 1.
5. **`.ops/` layer** — layout, ticket template, event schema, run record, STATUS
   generation, dashboard spec, mirror policy.
6. **Agents, models, skills** — role table, model matrix with verified IDs, tiers and
   fallback chains, quota tracking, the lean skill list (external / project), what
   `AGENTS.md` / `CLAUDE.md` contain, per-ticket skill loading rule.
7. **UX track** — principles doc, journeys, wireframe-before-code rule, AC usability
   items, review gates, usability session dates.
8. **Operating loop** — ticket → brief → delegate → verify → review → land → log, with
   the checklist reference.
9. **Risks and open items** — with owners and the date they block.

## Style

- Tables over prose for anything the user will scan repeatedly.
- Every number that is a guess says so.
- The plan is a baseline, not a contract: say which sections are expected to change after
  M0 feedback (usually 4 and 7).
