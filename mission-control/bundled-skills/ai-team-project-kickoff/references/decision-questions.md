# Decision question bank

Ask **one question per turn**. Put the recommended option first with "(Recommended)" and a
one-line reason in its description. Record each answer as `D-NNN` immediately. The user may
answer with a variant that is not in the options — accept it, restate it precisely, move on.

Before asking anything the environment can answer (installed CLIs, configured models,
connected API apps, existing repos), **check it yourself** with read-only commands / MCP
calls and report the facts. Users trust a question more when it starts with "I checked: …".

## Q1 — MVP scope

Options:
- **Thin vertical slice ("M0") (Recommended)** — one user type, one integration, the single
  daily-value moment (e.g. "weekly report + evidence-backed recommendations"), 3 roles,
  no portal/registry/secondary agents. Foundations (tenancy, audit, deterministic math)
  kept in full. Target 8–10 weeks.
- **M0 + one more integration** — reduces "users keep their old tool" risk, adds 2–3 weeks
  and another access-review track.
- **M0 + minimal end-customer portal** — closer to final product, adds an auth surface and
  isolation tests from day one.
- **The docs' MVP as written** — usually 6–12 months before real feedback. Say you don't
  recommend it and why.

## Q2 — Backend / web stack

Recommend explicit layers over decorator-heavy frameworks: AI implementers write less
boilerplate, and scope/permission checks stay visible in the code instead of hidden in
DI/decorators. Typical: Fastify + Zod + Drizzle, Next.js for web, Postgres (+pgvector if
retrieval), BullMQ/Redis for jobs, S3-compatible storage. Offer the docs' choice and a
full-stack-in-one-app option as alternatives with their trade-offs.

## Q3 — Language

- **English for every repo file (Recommended)** — agents execute English technical
  instructions more precisely; issues/commits/code stay one language. Conversation stays in
  the user's language.
- Mixed (agent files English, human-facing status in the user's language) — creates
  duplication because agents read DECISIONS too.
- Everything in the user's language — not recommended for implementer quality.

## Q4 — Pilot / first user

- A real external customer is ready → tight timeline, real data from week 1 after access.
- **The user / their own company is the first user** → fastest API access, biased feedback;
  plan an external user around the mid-milestone.
- Nobody yet → sandbox + fixtures, longer timeline, higher risk of building away from reality.

## Q5 — External access (APIs, developer apps, permissions)

Check connected MCPs first (e.g. Meta developer MCP: list apps → privileges per app). Then:
- App with the needed permissions exists → start the integration spike immediately.
- App exists without permissions → add them in development mode; app review in parallel.
- No app → ticket #1 includes creating it; build foundations meanwhile.
Recommend a **new dedicated app named after the product** rather than reusing an old one
(privacy policy, deletion URL and review stay clean).

## Q6 — Models per agent

Present what the CLIs actually expose. Typical shape:
- Main implementer (Codex): strongest model / high effort for critical tiers, mid model /
  high for standard, light model for simple; a different-family model at medium as a
  "second mind" for plan review and critical PRs only.
- Helper on a flat plan (agy): its strongest available model.
- Helper on free models (OpenCode): a **pool** with tiers A/B/C and rotation on rate limit;
  order decided by a bake-off on the first helper tickets.
Ask the user to confirm actual model IDs; never invent IDs.

## Q7 — Billing reality (multi-select)

For each agent: flat subscription (ChatGPT Plus/Pro, Google Pro …), per-token API, or
free-with-rate-limits. Remind the user that **flat plans still have 5-hour and weekly
windows**, so they are refilling budgets, not unlimited. This answer drives tiering,
fallback chains and what the dashboard tracks.

## Q8 — Repo and ticket mirror

- Repo: existing vs. create in ticket #1; private under personal account vs. org.
- Tickets: **Markdown in repo (Recommended)** as the audit-grade source of truth, optionally
  mirrored to GitHub Issues / Linear / Notion. External tool as the only source makes it
  harder for agents to read/write and weaker as an audit trail.

## Q9 — Implementation dashboard

- Local static app reading `.ops/` (always).
- Also published as an Artifact for mobile/anywhere viewing (optional; regenerate on demand).

## Q10 — UX direction and gate

Pick **one** visual-direction skill (e.g. minimalist for work tools; high-end for marketing
sites). Confirm UX-as-gate: principles doc + journeys before code, wireframes reviewed
before UI tickets, usability items in AC, critique/accessibility/copy review before approve,
a real usability session mid-milestone.

## Q11 — Skill list size (ask if the list grew past ~15)

Explain the three costs (index tokens on every run, load tokens, contradictions) and offer
the lean list: ~6 external authoritative + ~6 project skills in the repo; supervisor skills
stay global. Everything else becomes short sections in AGENTS.md / docs/conventions.
