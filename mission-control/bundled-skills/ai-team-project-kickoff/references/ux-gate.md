# UX as a gate

Requirement docs written for governance describe permissions and state machines, not the
user's Monday morning. If the product has a UI, make UX a gate every UI ticket passes
through, not a ticket among tickets.

## Foundations deliverables

- `docs/ux/principles.md` — personas with their context (time available, device, goal),
  5–8 principles, reusable patterns, prohibitions, a 10-question review checklist.
  Example principles for a data/AI work tool: every number shows why (freshness, coverage,
  why unavailable); AI output is always labelled advice / approved / executed; one primary
  decision per screen; empty states say what to do next; progressive disclosure.
- `docs/ux/journeys/` — the core journeys of the first milestone, step by step.
- `docs/ux/tokens.md` — one visual direction (pick **one** skill: minimalist for work
  tools, high-end for marketing), design tokens, component inventory (e.g. shadcn).

## Before any UI epic

Wireframe or screen (Stitch / Pencil / Figma MCP, or a quick HTML mock) reviewed with the
user **before** code. Minutes of design save hours of rework and implementer quota.

## In every UI ticket

- `skills:` includes the project UX skill + the web-design baseline + the framework skill.
- AC contains usability items explicitly: keyboard path, empty/loading/error states,
  microcopy for labels and errors, responsive at phone width, no colour-only status.

## Supervisor review gate (before approve)

design-critique (hierarchy, density) → accessibility review (WCAG target) → ux-copy pass →
compare with the wireframe → then the code checklist.

## Real users

A usability session with the user mid-milestone and with an external user near the end;
record findings with a research-synthesis skill into `.ops/memory/LEARNINGS.md` and the
UX principles doc.
