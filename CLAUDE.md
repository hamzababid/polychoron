# CLAUDE.md — Polychoron AI
### Read this file first. This is the entry point for all spec-driven development on this project.

## What Polychoron AI is
A multi-vertical, agentic compliance/governance platform. The platform
is organized as **Suites** (industry verticals) containing **Features**
(concrete agentic use cases). Today there is one suite (**BFSI**) with
one feature (**AML Detection**) — but the architecture is built so a
second feature, or a second suite entirely, is an additive change, not
a rewrite. Read `specs/platform/01-platform-architecture.md` before
touching anything, so you understand which code is platform-level
(shared forever) versus feature-level (AML-specific, and a template for
future features).

AML Detection itself: an AI agent chain investigates alerts flagged by
a bank's existing transaction-monitoring system, assembles evidence,
drafts a suspicion narrative, and prepares a regulatory filing
(STR/CTR) — a human compliance officer always makes the final suspicion
determination and files. Nothing in this system auto-files anything.

## Build philosophy: spec-driven development
For each unit of work: **Specify** (read the relevant spec fully) →
**Plan** (write a short implementation plan, check it against the
constitution) → **Tasks** (break into small testable units, following
`TASKS.md`'s ordering) → **Implement** (code + tests together) →
**Verify** (check every acceptance-criteria box before moving on).

## Directory map
```
app-api/                              NestJS — all screen-facing endpoints, RBAC, disposition/filing logic
agent-service/                        FastAPI (Python) — LangGraph nodes, Temporal workflows, model router
specs/
  platform/                          Shared across every suite and feature
    00-constitution.md                Non-negotiable rules — read before any code
    01-platform-architecture.md       The Suite → Feature hierarchy, read this second
    02-platform-data-models.py        Suite/Feature/Tenant/Envelope/RBAC primitives
    03-agent-framework-spec.md        The generic agent-orchestration contract
    04-claude-design-integration.md   How to use your Claude Design exports
    05-rbac-platform-spec.md          Platform RBAC + SSO (Phase 3)
    06-adding-a-new-feature-guide.md  Checklist for the platform's second feature
    07-adding-a-new-suite-guide.md    Checklist for the platform's second suite
    08-model-inference-routing-spec.md  Tenant-configurable self-hosted vs. foundation-API routing
    09-backend-service-boundary-spec.md  NestJS app API + FastAPI agent service split
    10-regulatory-knowledge-base-spec.md  Retrieval layer grounding agent reasoning in actual regulatory text (ADDITIVE — see file for in-progress-build migration notes)
    11-evals-and-guardrails-framework.md  Guardrail mechanisms + eval harness (ADDITIVE — same migration approach)
    tenant-user-journey.md            Narrative walkthrough of a real tenant's day-to-day use, cross-reference when building screens
    screens/
      admin-access-control.md         Platform-wide user/role management screen
  suites/
    bfsi/
      features/
        aml-detection/                 THE FIRST FEATURE — build this for the demo
          constitution-addendum.md
          role-manifest.md
          mvp-phases.md
          data-models.py
          golden-dataset-and-fairness-spec.md  ADDITIVE — see specs/platform/11-evals-and-guardrails-framework.md
          agent-implementation.md
          aml-e2e-flow.mermaid
          aml-agentic-workflow.mermaid
          phase-1-aml-core/            API contract, mock bank integration, demo script
          phase-2-full-aml/
          screens/                     11 screen specs
TASKS.md                               Ordered, checkable task list — work through top to bottom
docs/
  architecture/blueprint.html            As-built architecture drawing set (C4, ERDs, flows,
                                          sequences) — update alongside any change that makes a
                                          sheet inaccurate; not auto-generated
design-exports/
  bfsi/aml-detection/                  Drop your Claude Design exports here
  platform/                            Platform-level screen exports (e.g. Admin)
```

## Build order — do not skip ahead
This project is being built for an investor demo under real time
pressure. Even though the platform is designed for multiple future
suites/features, **only AML Detection ships for the demo.**

The backend is two services from day one — see
`specs/platform/09-backend-service-boundary-spec.md` for the full split
and the Temporal cross-language pattern that connects them. Do not
merge them into one service "for simplicity" — the split is what keeps
the human-facing and agent-facing halves of the constitution enforced
by construction, not just convention.

1. **Platform foundation** — data models, agent framework base classes,
   demo auth stub, model inference router (see
   `suites/bfsi/features/aml-detection/mvp-phases.md`
   Phase 1 — the demo auth stub is documented there since it's what
   Phase 1 actually needs, even though real auth is a platform concern
   long-term).
2. **AML Detection, Phase 1** — the four core screens (Alert Queue,
   Case Workspace, Filing Console, goAML Tracker) plus a basic
   Dashboard, against mocked bank integrations. This is the demo.
3. **AML Detection, Phase 2** — the remaining AML screens and full
   MLOps monitoring.
4. **Platform Phase 3** — real SSO, full RBAC, Admin & Access Control,
   multi-tenancy.
5. **(Future, not scheduled)** — a second feature or suite, following
   `platform/06-adding-a-new-feature-guide.md` /
   `platform/07-adding-a-new-suite-guide.md`.

## Non-negotiables (full detail in `specs/platform/00-constitution.md`)
- No auto-filing (or equivalent irreversible action) path exists in any feature, ever.
- Agent-authored and human-authored content must always be visually distinguishable.
- Every agent invocation writes an immutable, platform-shaped audit-log entry.
- Overriding an agent's recommendation requires a reason — enforced at the data layer.
- Adding a second feature or suite must never require editing platform-level code — if it does, that's an architecture bug, not a one-off exception.

## For the investor demo specifically
The AML Detection feature's Phase 1 must run end-to-end with realistic
seeded data (see
`suites/bfsi/features/aml-detection/phase-1-aml-core/demo-script.md`)
without requiring a live bank integration, live goAML connection, or
real SSO provider. Everything should be demoable on a laptop with no
external dependencies except an LLM API key. The suite/feature
navigation shell should still be visibly present in the demo (even with
only one suite and one feature to switch between) — it's a small thing
to build now and a meaningful thing to show investors as evidence the
platform isn't a single-purpose tool.
