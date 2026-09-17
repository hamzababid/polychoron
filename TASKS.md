# Polychoron AI — TASKS
### Work through this top to bottom. Do not start a later task before the previous one's tests pass. Check off as you go.

## Setup
- [x] Initialize **two** service repos/directories:
      `app-api/` (NestJS, TypeScript) and `agent-service/` (FastAPI,
      Python) — see `specs/platform/09-backend-service-boundary-spec.md`
      for the full split rationale. Do not build this as one service.
      (Also added `frontend/`, React + Vite + TS, for the nav shell.)
- [x] Read `specs/platform/00-constitution.md`,
      `specs/platform/01-platform-architecture.md`, and
      `specs/platform/09-backend-service-boundary-spec.md` in full
      before writing any feature code
- [x] Set up Postgres; implement the platform-level tables from
      `specs/platform/02-platform-data-models.py` (Suite, Feature,
      Tenant, FeatureCaseEnvelope, PlatformAgentActivityLogEntry,
      PlatformRole, PlatformUser, PlatformSession,
      TenantInferenceProfile) — both services connect to this one
      database, with table ownership split per the boundary spec
      (`infra/db/migrations/`, applied via `infra/db/migrate.py`)
- [x] Implement the base `PlatformAgentNode` contract (in
      `agent-service/`) described in
      `specs/platform/03-agent-framework-spec.md`
      (`app/platform/agent_node.py`, 10+ tests)
- [x] Set up Temporal (local dev instance via `infra/docker-compose.yml`);
      confirm both the Python worker (agent-service) and the
      TypeScript client (app-api) can reach it
- [x] Build the navigation shell (app-api + frontend) with a suite
      switcher and feature switcher — even with one suite and one
      feature registered today
- [x] Implement the model inference router in `agent-service/` (see
      `specs/platform/08-model-inference-routing-spec.md`):
      `TenantInferenceProfile`, `validate_consistency()`,
      `resolve_inference_provider()`, `get_inference_client()`
      (`app/platform/inference/`)
- [x] Seed one `TenantInferenceProfile` for the demo tenant:
      `deployment_model=SHARED_SAAS`, `data_residency_required=False`,
      `network_egress_approved=True`, `default_provider=FOUNDATION_API`
      — **note:** Phase 1 uses OpenAI (not Claude/Anthropic as this
      spec assumed) via the FOUNDATION_API path, per explicit user
      direction — the router/interface are provider-agnostic so this
      was a swap contained to `FoundationAPIInferenceClient`. The
      `SelfHostedInferenceClient` path is still a "not yet implemented"
      stub, as specified.
- [x] Seed the registry: one `Suite` row (`bfsi`), one `Feature` row
      (`aml_detection`, `status="beta"`)
      (`agent-service/scripts/seed_platform_registry.py`)
- [x] Set up basic CI (lint + test on push, for both services)
      (`.github/workflows/ci.yml` — commands verified locally against
      the same docker-compose stack; not yet run through actual GitHub
      Actions since there's no remote/push yet)

## AML Detection — Phase 1 (Data & Ingestion)
- [x] Implement AML's feature-specific tables from
      `specs/suites/bfsi/features/aml-detection/data-models.py`
      (`Case`, `InboundAlert`, `Disposition`, `STRFiling`, etc.)
      (`infra/db/migrations/003_aml_detection_core.sql` — Phase 1 scope
      only: Case/EvidenceBundle/TypologyMatch/CaseAssessment/
      Disposition/STRFiling; `SamplingReview` deferred to Phase 2)
- [x] Every `Case` created must also write a `FeatureCaseEnvelope`
      (platform table) with `feature_code="aml_detection"`,
      `suite_code="bfsi"`
- [x] In `app-api/` (NestJS): implement
      `POST /api/v1/features/aml_detection/alerts/ingest` (see
      `phase-1-aml-core/api-contracts-phase1.md`) — writes the `Case` +
      `FeatureCaseEnvelope` rows, then starts the corresponding Temporal
      workflow via the TypeScript client (see
      `specs/platform/09-backend-service-boundary-spec.md` — do not
      call `agent-service/` directly over HTTP for this)
- [x] In `agent-service/` (Python): build the mock bank API service
      (see `phase-1-aml-core/mock-bank-integration-spec.md`)
- [x] Write and load the two seed scenarios
      (`agent-service/app/features/aml_detection/mock_bank/seed_data.py`
      + `scripts/inject_demo_alert.py`; prior cleared case seeded via
      `scripts/seed_aml_demo_data.py`)
- [x] Test: posting an `InboundAlert` to `app-api/` creates a `Case` AND
      a `FeatureCaseEnvelope` in the same transaction, AND successfully
      starts the Temporal workflow running on the `agent-service/`
      worker (`app-api/test/aml-ingest.e2e-spec.ts`)

## AML Detection — Phase 1 (Agent Chain)
- [x] In `agent-service/`: implement Evidence Gathering, Pattern
      Matching, and Case & Narrative agent nodes against the
      `PlatformAgentNode` contract (see `agent-implementation.md`)
      (`app/features/aml_detection/nodes/`)
- [x] Wire them into a Temporal workflow with a signal-based human
      checkpoint pause after the third node — the signal is sent by
      `app-api/`'s disposition endpoint (see the boundary spec's
      "human checkpoint resume" pattern)
      (`POST .../cases/:caseId/disposition`, minimal but real: DB write
      + Case.status transition + Temporal signal — RBAC/full Case
      Workspace UI still belongs to the Screens task below)
- [x] Confirm every node writes a `PlatformAgentActivityLogEntry`
      tagged `suite_code="bfsi"`, `feature_code="aml_detection"`,
      with `model_provider` populated from the router's resolution
      (constitution rule 3 and rule 11 — not optional)
- [x] Test: running the workflow against both seed scenarios produces
      plausible output (structuring case → RECOMMEND_STR, high
      confidence; seasonal case → ESCALATE, medium confidence)
      (verified live end-to-end through the real Temporal workflow —
      see `app-api/test/aml-disposition.e2e-spec.ts`, opt-in via
      `RUN_LIVE_LLM_TESTS=1` since it makes real OpenAI calls)

## Platform — Demo Auth Stub
- [x] In `app-api/`: implement
      `DemoUser`/`DemoSession`/`POST /api/v1/auth/demo-login` (this is
      documented as a Phase 1 shortcut in the AML feature's
      `mvp-phases.md` — keep it minimal, constitution rule 9)
      (`src/platform/auth/` — DemoUser/DemoSession resolve directly to
      the existing PlatformUser/PlatformSession entities rather than
      introducing separate throwaway types, since those are already
      the platform-level shapes Phase 3's real RBAC will keep using;
      what's "demo" here is the login method, not the data shape)
- [x] Seed 2 demo users, mapped per
      `suites/bfsi/features/aml-detection/role-manifest.md`'s note on
      DemoRole → real role mapping
      (`src/scripts/seed-demo-users.ts`, run via `npm run seed:demo-users`
      after `npm run build` — also seeds the 3 `platform_roles` catalog
      rows from the role manifest)

## AML Detection — Phase 1 (Screens)
**Note on scope resolution:** these 5 screen specs reference an older,
unnamespaced API (`/api/v1/alerts`, `/api/v1/cases/...`) and files that
don't exist in this repo (`02-api-contracts.md`, `genosai_case_models.py`)
— leftovers from before the platform's namespacing/two-service split.
Per explicit direction, built against the current, namespaced
`api-contracts-phase1.md` contract instead. Two models the specs asked
for but that didn't exist yet (`FMUFollowup`, `BranchRiskSnapshot`)
were added, minimally scoped. Dashboard's screen spec describes the
full Phase 2 Reporting & MI surface (trend chart, false-positive trend
over time) — built to api-contracts-phase1.md's actual Phase 1 contract
(`reports/summary-basic`, four top-line figures) plus the branch
heat-map instead; the full trend/time-series version is Phase 2 scope.

**Verification status:** all endpoints below are backend-tested (28
passing e2e tests total across ingestion/auth/screens, covering RBAC,
the full filing lifecycle, and dashboard aggregates). The frontend
compiles cleanly and its API integration was verified via direct HTTP
calls through the dev proxy (login → session → screen data, for every
screen). **Not yet verified: actual rendering/interaction in a
browser** — no browser tooling was available this session. Before the
Demo Readiness Gate below, do a visual pass on all 5 screens (`npm run
dev` in `frontend/`, log in as both demo users) and fix anything that
looks broken that automated tests wouldn't catch.

- [x] All screen-facing endpoints below live in `app-api/`; the
      frontend consumes them directly (never calls `agent-service/`)
- [x] Alert Queue — spec: `screens/02-alert-queue.md`
      (bulk-clear from the Claude Design export not implemented — no
      Phase 1 API contract for it; sort is server-fixed, satisfying the
      "no live re-sort" acceptance criterion by construction)
- [x] Case Workspace — spec: `screens/03-case-workspace.md`
      (highest-priority screen — built with care, not rushed. Agent
      narrative renders read-only/distinctly styled rather than as a
      persisting-nowhere editable textarea, since only Filing
      Console's final_narrative has a save path)
- [x] Filing Console — spec: `screens/04-filing-console.md`
      (attestation gate built first: submit is client-disabled until
      the checklist + attestation are complete, and the server
      independently re-validates `can_submit` at submit time —
      verified via an e2e test that a completed-checklist-but-
      unconfirmed attestation gets a 403 on submit)
- [x] goAML Tracker — spec: `screens/05-goaml-tracker.md`
- [x] Dashboard (basic) — spec: `screens/01-dashboard.md`
- [x] For each screen: checked its acceptance criteria against what
      was actually built (see notes above for the two known gaps:
      bulk-clear, and unverified browser rendering)

## Demo Readiness Gate
- [ ] Run the full walkthrough in
      `phase-1-aml-core/demo-script.md` live, start to finish
- [ ] Fix anything that breaks the "what must not happen" list in that
      script
- [ ] Confirm the suite/feature switcher is visibly present and
      functional in the demo, even with only one option in each
- [ ] **Gate: do not start AML Phase 2 or platform Phase 3 until this
      demo runs cleanly**

---

## AML Detection — Phase 2 (Full Feature Set)
(Expand into task-level detail once Phase 1 is demo-complete — write
`phase-2-full-aml/api-contracts-phase2.md` first.)
- [ ] Typology & Rules Console — spec: `screens/06-typology-rules-console.md`
- [ ] Sanctions & PEP Screening Hub — spec: `screens/07-screening-hub.md`
- [ ] Customer 360 — spec: `screens/08-customer-360.md`
- [ ] Model Governance & Audit — spec: `screens/09-model-governance-audit.md`
- [ ] Reporting & MI — spec: `screens/10-reporting-mi.md`
- [ ] Full MLOps tracing layer (Langfuse/Phoenix + OpenTelemetry)
- [ ] Shadow-mode backtesting implementation

---

## Platform — Phase 3 (Enterprise Readiness)
(Write a platform-level API contract file first, covering auth,
tenancy, and role assignment endpoints.)
- [ ] Real OIDC/SAML integration — spec: `specs/platform/05-rbac-platform-spec.md`
- [ ] Admin & Access Control screen — spec: `specs/platform/screens/admin-access-control.md`
- [ ] Retire the Phase 1 demo-auth stub entirely
- [ ] Multi-tenancy enforcement across all feature data access
- [ ] Real bank integration adapter (replacing the AML feature's mock service)
- [ ] Real goAML/FMU connectivity (replacing `mock_goaml_submit()`)

---

## Future (not scheduled — do not start without explicit direction)
- [ ] A second feature under BFSI — follow
      `specs/platform/06-adding-a-new-feature-guide.md`
- [ ] A second suite — follow
      `specs/platform/07-adding-a-new-suite-guide.md`
