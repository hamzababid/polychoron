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
- [x] Run the full walkthrough in
      `phase-1-aml-core/demo-script.md` live, start to finish
      (live in a browser by the user; environment reset to a clean
      state via `agent-service/scripts/reset_demo_environment.py`
      first — both scenarios verified producing the expected,
      visibly-different outcomes: Recommend STR / risk 85 vs.
      Escalate / risk 70)
- [x] Fix anything that breaks the "what must not happen" list in that
      script (found + fixed: no way to log out and switch demo users
      — added a logout control to the nav shell)
- [x] Confirm the suite/feature switcher is visibly present and
      functional in the demo, even with only one option in each
- [x] **Gate: demo runs cleanly — proceeding to AML Phase 2**

---

## ADDITIVE — Regulatory Knowledge Base (added mid-build; layer in without disrupting whatever is currently in progress)
See `specs/platform/10-regulatory-knowledge-base-spec.md` and
`specs/suites/bfsi/features/aml-detection/regulatory-corpus-manifest.md`.
These fields/tables are additive (new tables, `Optional`/defaulted
fields) — apply via migration, do not alter existing model shapes or
break passing tests. If the agent chain is already implemented and
passing its tests, add the retrieval call as an additive step inside
the Pattern Matching node rather than a hard dependency.
- [x] Add `RegulatoryDocument`, `RegulatoryChunk` tables (platform-level,
      pgvector-backed)
- [x] Add `regulatory_citations`/`regulatory_context_used` fields to
      `TypologyMatch`/`CaseAssessment` (default empty list)
- [x] Implement `retrieve_regulatory_context()` in `agent-service/`
- [x] Hand-seed the Phase 1 minimal corpus (structuring + high-velocity
      indicator chunks only — see the manifest's Phase 1 section)
- [x] Wire the retrieval call into the Pattern Matching Agent node as
      an additive step
- [x] Test: re-running both existing seed scenarios still passes their
      existing assertions, AND now returns non-empty
      `regulatory_citations` for the structuring case
- [x] Defer the full ingestion pipeline (document upload UI, chunking
      service, embedding refresh jobs) to AML Phase 2 — do not build it
      now

---

## AML Detection — Phase 2 (Full Feature Set)
- [x] Write `phase-2-full-aml/api-contracts-phase2.md` — three scope
      decisions made explicitly with the project owner first (demo-stub
      RBAC extension for model_risk_audit/external_examiner rather than
      real Phase 3 SSO; Screening Hub's freeze action built but
      server-disabled with 501, never a silent no-op; Reporting & MI
      ships generic PDF/CSV only, no SBP-specific template yet)

### Platform — Demo Auth Stub extension (needed by Typology Console + Model Governance)
- [x] Seed 2 more demo users: `platform.model_risk_audit`,
      `platform.external_examiner` — same stub as Phase 1's 2 AML
      users, not a new mechanism (also seeded a 3rd missing user,
      `aml_detection.mlro_compliance_head`, which had a role definition
      since Phase 1 but no demo user — needed for Typology Console's
      promote action)

### Typology & Rules Console — spec: `screens/06-typology-rules-console.md`
- [x] `TypologyConfig` + `TypologyConfigVersion` tables; migrate the
      Phase 1 hardcoded `typology_catalog.py` catalog into seeded rows
      (also had to relax `platform_roles.feature_code` to nullable —
      it only anticipated feature-namespaced roles, not the
      cross-feature platform.* roles this screen needs)
- [x] Swap the Pattern Matching Agent's typology-lookup tool
      (`agent-service`) from the hardcoded catalog to a DB read —
      confirmed both seed scenarios still match their same typology
      (structuring_subthreshold / deposit_velocity_shift)
- [x] `GET .../typologies` with computed metrics (alert_volume_30d,
      str_conversion_rate, false_positive_rate) derived from
      Case/Disposition, not hand-maintained
- [x] `GET .../typologies/{code}/history`
- [x] `TypologyBacktestJob` table + `POST .../typologies/{code}/backtest`
      (async, queued→running→complete lifecycle) + `GET
      .../typologies/backtest-jobs/{job_id}`. **Scope note:** this
      computes a real agreement-rate metric from historical Case/
      Disposition data for the typology, not a true shadow-mode re-run
      of a draft rule-logic edit through the agent chain
      (agent-implementation.md's fuller spec) — that requires
      re-invoking Pattern Matching against historical evidence bundles
      with the draft config, a larger follow-up, flagged in code
      comments rather than silently presented as a real shadow
      comparison
- [x] `TypologyPromotion` table + `POST .../typologies/{code}/promote`,
      gated to `aml_detection.mlro_compliance_head`; a promotion with
      no linked backtest job is flagged by construction (backtest_job_id
      is null, checkable by any future audit view) and the frontend
      warns before allowing it, never silently allowed
- [x] Active/inactive toggle writes a version-history row, same as a
      rule-logic edit (tested: two writes produce v2, v3 with distinct
      reasons)
- [x] Screen: live-vs-draft visually unmistakable (solid green rail vs.
      hatched grey); backtest job status shown (queued/running/complete)
      via polling, not a static spinner
- [x] Test: `promote` returns 403 for `model_risk_audit`;
      `aml_detection.mlro_compliance_head` succeeds (5 e2e tests,
      `app-api/test/typology-console.e2e-spec.ts`)

### Sanctions & PEP Screening Hub — spec: `screens/07-screening-hub.md`
- [ ] `ScreeningHit` table (separate from the `ScreeningResult` embedded
      in `EvidenceBundle`) — this is Phase 2's first standalone
      screening queue, not case-embedded data
- [ ] `GET .../screening/hits?status=held`, `GET .../screening/hits/{hit_id}`
      with side-by-side customer-vs-watchlist field comparison, matching
      fields visually highlighted
- [ ] `POST .../screening/hits/{hit_id}/disposition` — `true_match` path
      returns `501` with a clear "not yet available" message (never a
      silent no-op); every disposition, including `false_match`, writes
      an audit entry with officer identity
- [ ] Screen: freeze vs. release actions visually distinct enough to
      minimize mis-click risk — flagged in the spec as the platform's
      single highest-consequence UI risk; get a second look at this
      button layout specifically before calling it done
- [ ] Live "time held" counter per row, not a static timestamp

### Customer 360 — spec: `screens/08-customer-360.md`
- [ ] `GET .../customers/{customer_id}/360` — aggregates across all of
      a customer's cases (KYC, derived accounts list, prior cases,
      screening history, linked entities)
- [ ] Reuse `LinkedEntityGraph` (already built for Case Workspace) fed
      from this customer's aggregated linked entities — do not
      reimplement
- [ ] Reachable as a real bookmarkable route from Alert Queue, Case
      Workspace, and Screening Hub — not a modal
- [ ] "No screening history" renders as an explicit clean-state message,
      not an empty section
- [ ] Test: confirm no write endpoints exist on this route — read-only
      by construction

### Model Governance & Audit — spec: `screens/09-model-governance-audit.md`
- [ ] `SamplingReview` table (already modeled in `data-models.py`,
      table deliberately deferred from Phase 1's migration — add now)
- [ ] A simple random-sample selection job over newly-CLEARED
      dispositions (no stratification yet)
- [ ] `GET .../governance/sampling` — real agreement-rate trend from
      actual `SamplingReview` rows, never a placeholder series (this
      number is the reason the screen exists)
- [ ] `POST .../governance/sampling/{case_id}/review`
- [ ] `GET .../governance/consistency` — STR conversion rate by
      typology, broken out by branch
- [ ] `GET .../governance/model-versions` — current agent_version per
      node, with change history
- [ ] `GET .../governance/data-lineage` — mock bank / Temporal /
      inference-provider status + last-refresh, labeled honestly as
      what Phase 1/2 actually has (not fictional real-integration names)
- [ ] Every figure on screen carries an "as of [timestamp]" label
- [ ] RBAC: `aml_detection.mlro_compliance_head` full;
      `platform.model_risk_audit` read-only;
      `platform.external_examiner` read-only, sampling data only —
      test that examiner access never leaks full case content

### Reporting & MI — spec: `screens/10-reporting-mi.md`
- [ ] `GET .../reports/summary` — same computation `DashboardService`
      already has, at full granularity; test that Dashboard and
      Reporting figures match exactly for the same period
- [ ] `POST .../reports/generate` (PDF/CSV only, see scope decision
      above), async job; generated reports persisted and
      re-downloadable byte-for-byte, never regenerated on request
- [ ] `GET .../reports/history`, `GET .../reports/{report_id}/download`
- [ ] Screen: report generation in progress doesn't block the rest of
      the screen
- [ ] RBAC: `aml_detection.mlro_compliance_head`

### MLOps tracing layer (platform-wide, not a screen)
- [ ] OpenTelemetry spans for every agent node execution
      (`agent-service`)
- [ ] Langfuse (or Phoenix) spans specifically for LLM calls — prompt,
      completion, token cost, latency
- [ ] Link every span to `case_id`; confirm `platform_agent_activity_log`
      (Phase 1's constitution rule 3 audit-of-record) is unchanged by
      this — tracing is additive observability, not a replacement audit
      source
- [ ] Case Workspace's activity-log expansion and the new Agent
      Activity Log detail view read from this tracing data

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
