# Phase 2 — API Contracts (Full AML Feature Set)
**AML Detection's Phase 2 API surface — namespaced under
`/api/v1/features/aml_detection/` per platform convention, same as
Phase 1. This file exists per `TASKS.md`'s instruction to write it
before expanding Phase 2 into task-level detail.**

Written after reading all five Phase 2 screen specs in full. Three
scope decisions were made explicitly with the project owner before
writing this (recorded here so they're not re-litigated per screen):

1. **RBAC for Typology Console / Model Governance**: `mvp-phases.md`
   scopes the full platform RBAC/SSO system to Phase 3, but these two
   screens need `platform.model_risk_audit` and
   `platform.external_examiner` (defined in
   `platform/05-rbac-platform-spec.md`). Decision: extend the existing
   Phase 1 demo-login stub with two more seeded demo users carrying
   these roles — no real SSO, no time-boxed/auto-expiring examiner
   credentials (that mechanism stays Phase 3 scope). This is the same
   stub, not a second one.
2. **Screening Hub's TFS freeze action**: needs a real core-banking
   endpoint that doesn't exist yet (only the Phase 1/2 mock bank
   exists). Decision: build the full screen; the freeze action is
   present but server-side disabled, returning `501 Not Implemented`
   with a clear message — never a silent no-op, per the screen spec's
   own instruction.
3. **Reporting & MI's regulatory export**: no real SBP bi-annual
   submission format available. Decision: generic PDF/CSV period
   export only for Phase 2; the SBP-specific template is added later
   once compliance provides it.

## New data models this phase adds
(Extends `specs/suites/bfsi/features/aml-detection/data-models.py`.
`SamplingReview` already existed in that file but had no table until
now — Phase 1's migration comment explicitly deferred it.)

- **`TypologyConfig`**: `typology_code` (PK), `typology_label`,
  `rule_logic_description`, `active`, `production_version`,
  `created_at`. Replaces Phase 1's hardcoded, in-repo
  `agent-service/app/features/aml_detection/typology_catalog.py` as
  the Pattern Matching Agent's "typology config lookup" tool — Phase 1
  anticipated this swap explicitly.
- **`TypologyConfigVersion`**: append-only version/change history —
  `typology_code`, `version`, `rule_logic_description`, `active`,
  `changed_by`, `changed_at`, `change_reason`. Every edit *and* every
  active/inactive toggle writes one row (screen spec: "toggling
  active/inactive is itself a change requiring the same version-history
  logging as a rule-logic edit").
- **`TypologyBacktestJob`**: `job_id`, `typology_code`, `status`
  (`queued`/`running`/`complete`/`failed`), `started_at`,
  `completed_at`, `comparison_report` (jsonb — agreement rate vs.
  production, broken out by typology, per
  `agent-implementation.md`'s shadow-mode spec).
- **`TypologyPromotion`**: `typology_code`, `promoted_version`,
  `backtest_job_id` (nullable — but a null here must be visibly
  flagged per the screen's acceptance criteria, never silently
  allowed), `promoted_by`, `promoted_at`.
- **`ScreeningHit`**: a dedicated queue entity, not just the
  `ScreeningResult` embedded in `EvidenceBundle` — `hit_id`,
  `customer_id`, `list_source`, `matched_name`, `match_confidence`,
  `match_rationale`, `status` (`held`/`true_match`/`false_match`/`escalated`),
  `held_since`, `disposition_officer_id`, `disposition_reason`,
  `decided_at`.
- **`SamplingReview`**: as already specified in `data-models.py` — the
  table is added now. A `sampling_selection` job flags a configurable
  percentage of newly-CLEARED dispositions for review (simple random
  sample for Phase 2 — no stratification yet).
- Customer 360's "accounts list": **no new `Account` table.** The mock
  bank has never modeled accounts as first-class entities with their
  own attributes (type, status, etc.) — only as ID strings on
  `InboundAlert.account_ids` and `TransactionRecord`. Fabricating
  account metadata that doesn't exist anywhere would be dishonest
  demo data. Customer 360's accounts list is a *derived* view: distinct
  account IDs across a customer's cases, with which cases reference
  each. Revisit if a real core-banking accounts feed ever exists
  (Phase 3).

## Typology & Rules Console
`GET /api/v1/features/aml_detection/typologies` → `TypologyConfig[]`
with computed metrics (`alert_volume_30d`, `str_conversion_rate`,
`false_positive_rate`) joined from `Case`/`Disposition`, not
hand-maintained columns.
`GET /api/v1/features/aml_detection/typologies/{code}/history` → `TypologyConfigVersion[]`
`POST /api/v1/features/aml_detection/typologies/{code}/backtest` → starts a `TypologyBacktestJob`, returns `job_id`
`GET /api/v1/features/aml_detection/typologies/backtest-jobs/{job_id}` → job status + `comparison_report` once complete
`POST /api/v1/features/aml_detection/typologies/{code}/promote` → Body: `{backtest_job_id?, reason}` — `platform.mlro_compliance_head` only (feature-level `aml_detection.mlro_compliance_head`, per role-manifest.md — the console's RBAC line in the screen spec names the bare role; this repo's actual role codes are feature-namespaced, same as every other Phase 1 endpoint)

## Sanctions & PEP Screening Hub
`GET /api/v1/features/aml_detection/screening/hits?status=held` → paginated `ScreeningHit[]`
`GET /api/v1/features/aml_detection/screening/hits/{hit_id}` → detail, with side-by-side customer vs. watchlist field comparison
`POST /api/v1/features/aml_detection/screening/hits/{hit_id}/disposition` → Body: `{disposition: 'true_match'|'false_match'|'escalate', officer_id, reason}`
  - `true_match` → attempts the TFS freeze action → **`501 Not Implemented`**, `{message: "Core-banking freeze integration not yet available — case flagged for manual freeze outside this system"}`. The disposition itself (and its audit entry) is still recorded; only the automated freeze call is blocked.
  - Every disposition (including `false_match`) writes an audit entry with officer identity, per the screen's acceptance criteria.

## Customer 360
`GET /api/v1/features/aml_detection/customers/{customer_id}/360` → `{kyc (latest snapshot across cases), accounts (derived), priorCases, screeningHistory, linkedEntities (aggregated across all this customer's cases)}`
Read-only — no write endpoints on this route, per the screen's acceptance criteria.

## Model Governance & Audit
`GET /api/v1/features/aml_detection/governance/sampling` → `SamplingReview[]` + aggregate agreement-rate trend over time
`POST /api/v1/features/aml_detection/governance/sampling/{case_id}/review` → Body: `SamplingReview` fields — records a reviewer's agree/disagree
`GET /api/v1/features/aml_detection/governance/consistency` → STR conversion rate by typology, broken out by branch
`GET /api/v1/features/aml_detection/governance/model-versions` → current `agent_version` per node (evidence/pattern/narrative), read from agent-service's node classes, with change history from `platform_agent_activity_log`
`GET /api/v1/features/aml_detection/governance/data-lineage` → status + last-refresh timestamp per upstream dependency (Phase 1/2 honesty: this lists the **mock** bank API, Temporal, and the OpenAI-backed inference provider — not fictional "core banking"/"sanctions list" systems that don't exist yet)
RBAC: `aml_detection.mlro_compliance_head`, `platform.model_risk_audit`, `platform.external_examiner` (read-only — sampling data only, never full case content, per the screen's acceptance criteria)

## Reporting & MI
`GET /api/v1/features/aml_detection/reports/summary?period=&compare_previous=` → same aggregation `DashboardService` already computes, at full granularity (this is the "single source of truth" the Dashboard's basic summary is a rollup of — both must read from the same computation, never diverge)
`POST /api/v1/features/aml_detection/reports/generate` → Body: `{period, format: 'pdf'|'csv'}` (no `sbp_biannual` format option yet — see decision #3 above), async job, returns `report_id`
`GET /api/v1/features/aml_detection/reports/history` → previously generated reports, each re-downloadable byte-for-byte (persisted file, not regenerated on request)
`GET /api/v1/features/aml_detection/reports/{report_id}/download`
RBAC: `aml_detection.mlro_compliance_head`

## MLOps tracing (platform-wide, not a screen)
`platform_agent_activity_log` (Phase 1) remains the constitution rule
3 audit-of-record — this doesn't change or get replaced. Phase 2 adds
OpenTelemetry spans for every node execution plus Langfuse spans
specifically for LLM calls (prompt, completion, token cost, latency),
per `agent-implementation.md`. This is additive observability for
debugging/cost-tracking, feeding a richer Agent Activity Log detail
view — not a second source of truth for the audit trail itself.

## What's still explicitly deferred
- Shadow-mode's actual comparison-report computation logic (agreement
  rate by typology) — the job/table shape is specified above; the
  comparison algorithm itself is a task-level detail to work out when
  building the Typology Console.
- Real TFS freeze integration, real SBP report template, real
  platform RBAC/SSO, multi-tenancy — all Phase 3, per `mvp-phases.md`.
