# Phase 1 — API Contracts (scoped to MVP)
**This is AML Detection's own API surface — namespaced under `/api/v1/features/aml_detection/` per the platform convention (see `platform/01-platform-architecture.md`). Platform-owned routes (auth) are not namespaced.**

### Full API surface (Phase 2/3 endpoints) lives in later specs. This is only what Phase 1 needs.

## Auth (demo stub — see constitution rule 9, do not over-build this)
- `POST /api/v1/auth/demo-login` → Body: `{user_id}`. Returns a
  `DemoSession`. No password, no MFA — this is a seeded-user picker,
  not real authentication.

## Ingestion
- `POST /api/v1/features/aml_detection/alerts/ingest` → Body: `InboundAlert`. Creates a `Case`
  in `OPEN` status, triggers the agent chain asynchronously.

## Alert Queue
- `GET /api/v1/features/aml_detection/alerts?status=&risk_tier=` → paginated `Case` summaries
- `POST /api/v1/features/aml_detection/alerts/{case_id}/claim`

## Case Workspace
- `GET /api/v1/features/aml_detection/cases/{case_id}` → full `Case` object
- `GET /api/v1/features/aml_detection/cases/{case_id}/activity-log` → `AgentActivityLogEntry` list
- `POST /api/v1/features/aml_detection/cases/{case_id}/disposition` → Body: `Disposition`

## Filing Console
- `GET /api/v1/features/aml_detection/cases/{case_id}/filing-draft` → `STRFieldsDraft` + narrative
- `POST /api/v1/features/aml_detection/cases/{case_id}/filing/attest` → Body: `OfficerAttestation`
- `POST /api/v1/features/aml_detection/cases/{case_id}/filing/submit` → re-validates
  `can_submit` server-side, calls `mock_goaml_submit()`

## goAML Tracker
- `GET /api/v1/features/aml_detection/filings` → paginated `STRFiling` summaries
- `GET /api/v1/features/aml_detection/filings/{filing_id}` → detail
- `POST /api/v1/features/aml_detection/filings/{filing_id}/simulate-acknowledgment` →
  **demo-only endpoint**, manually advances status for the live demo,
  does not exist in Phase 3

## Dashboard (minimal — Phase 2 has the full version)
- `GET /api/v1/features/aml_detection/reports/summary-basic` → just the four top-line counts
  needed for a non-empty Phase 1 dashboard tile row
- `GET /api/v1/features/aml_detection/reports/summary-trends` → **ADDITIVE**
  (TASKS.md's "ADDITIVE — Dashboard Trend Widgets"), fixed 6-month
  window, no query params yet (Phase 2's `reports/summary` adds
  `period`/`compare_previous`): last-6-months monthly trend (alerts
  raised, STR filed, STR conversion rate, false-positive rate),
  agreed-vs-overrode disposition breakdown, top-3 most-aging open
  alerts. Same `DashboardController`/`DashboardService` as
  `summary-basic`, not a new service — see
  `screens/01-dashboard.md`'s "single source of truth" note

## What's deliberately NOT in Phase 1
Everything under `/api/v1/features/aml_detection/typologies`, `/api/v1/features/aml_detection/screening`,
`/api/v1/features/aml_detection/customers/{id}/360`, `/api/v1/features/aml_detection/governance`,
`/api/v1/features/aml_detection/reports/generate` (full version), and `/api/v1/roles` — these
belong to Phase 2/3 API contract files, build them when those phases
start.
