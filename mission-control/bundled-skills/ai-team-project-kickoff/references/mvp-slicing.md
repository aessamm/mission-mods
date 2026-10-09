# Cutting the first milestone ("M0") — thin vertical slice

The docs' MVP is usually a platform. Your job is to find the **one daily-value moment** and
build only the path to it, on foundations that will not be thrown away.

## Method

1. Name the primary user and their daily moment in one sentence.
   *"A media buyer opens the app Monday morning and gets a weekly report with 3–5
   evidence-backed recommendations for one client."*
2. List the 5 steps of that journey. Everything not on the path is out of M0.
3. Split the docs' MVP features into three buckets:

| Keep in full (foundations) | Keep in the narrowest form | Defer to M1+ |
|---|---|---|
| Tenancy/scoping on every table, audit log, deterministic math, immutable evidence, event outbox if the architecture relies on it | Roles (3 instead of 10), profiles (manual instead of AI-extracted), reports (PDF/link instead of portal), agents (1 orchestrator with 3 fixed skills, no registry UI), memory (2 layers not 4) | Secondary agents, registries with lifecycles, portals, cross-tenant learning, extra integrations, alerts/tasks, localization, competitor research, autonomy |

   Foundations are cheaper now than later; width is cheaper later than now.
4. Write M0 exit criteria as a user story that can be demonstrated live.
5. Target 8–10 weeks with a real first user by mid-milestone.

## Signals that the slice is still too fat

- More than ~25 tickets for M0.
- Any ticket estimated L that cannot be split.
- A second external integration or an auth surface for a second user type.
- A "registry", "marketplace", "portal" or "orchestrator of orchestrators" in scope.

## Plan levels (how much detail for what)

- Level 0 Roadmap: milestones + exit criteria, one page.
- Level 1 Foundations: repo layout, domain modules, tenancy model, tool/event contracts,
  conventions — decided now, changing later is expensive.
- Level 2 Epics: for the first two milestones.
- Level 3 Tickets: in full for M0 only. After M0's first feedback ~40% of priorities move.
