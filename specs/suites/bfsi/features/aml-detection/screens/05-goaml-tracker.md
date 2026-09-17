# Screen spec: goAML Submission Tracker
**PHASE: 1 (MVP demo core)**

**Claude Design reference file:** `goaml-tracker.*`
**Route:** `/filings`
**RBAC (Phase 1 demo stub):** DemoRole.COMPLIANCE_OFFICER only.

## Data source
`GET /api/v1/filings` (list) / `GET /api/v1/filings/{filing_id}` (detail)

## Component → data binding
- List row: report type badge → `STRFiling.report_type`; status
  stepper → `STRFiling.submission_status`; goAML reference →
  `goaml_reference`; retention flag → computed from
  `retention_expiry` (flag when within, e.g., 90 days of a disposal
  review window — confirm exact policy window with compliance before
  hardcoding)
- Detail panel: full stepper with timestamps
  (`submitted_at`/`acknowledged_at`); FMU follow-up log → new
  `FMUFollowup` records (see `02-api-contracts.md` note — this model
  isn't in `genosai_case_models.py` yet, add it)
- Link back to originating case → `STRFiling.case_id` → Case Workspace

## Interactions
- Status updates arrive via `POST /api/v1/filings/{filing_id}/status-update`
  — confirm with your goAML integration approach whether this is a
  polling job you build or an inbound webhook from goAML/FMU

## States
- Pending acknowledgment (submitted, not yet acknowledged): stepper
  shows first step complete, second in-progress, calm/neutral styling
  — this is a normal waiting state, not an error
- Retention window approaching: visible flag, not a blocking alert —
  this is informational for record-disposal review, not an urgent action

## Acceptance criteria
- [ ] This screen and every API it calls is unreachable by any role
      outside `senior_officer_l2`/`mlro_compliance_head` — confidential
      by nature, confirm this is enforced identically to Filing Console
- [ ] Retention-expiry calculation is server-computed at submission time
      (`submitted_at + 10 years`), never recalculated client-side
