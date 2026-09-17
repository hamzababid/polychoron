# Screen spec: Alert Queue
**PHASE: 1 (MVP demo core)**

**Claude Design reference file:** `alert-queue.*`
**Route:** `/alerts`
**RBAC (Phase 1 demo stub):** both DemoRole.ANALYST and DemoRole.COMPLIANCE_OFFICER can view and claim; full role separation is Phase 3, see phase-3-enterprise/rbac-spec.md

## Data source
`GET /api/v1/alerts` (see `02-api-contracts.md` for filters)

## Component → data binding
- Risk badge + tooltip → `CaseAssessment.risk_score` +
  `assessment.draft_narrative` first sentence as the "why" tooltip
- Typology pill → `TypologyMatch.typology_label`
- Agent recommendation label → `CaseAssessment.recommendation` — render
  as a label/tag, **never as a pre-checked or pre-selected control**
- SLA timer → computed from `Case.created_at` + typology-specific SLA
  target (define SLA targets per typology in the typology config)
- Assigned analyst → `Case.assigned_analyst_id` (resolve to name via
  existing user management)

## Interactions
- Row click → navigate to `/cases/{case_id}` (Case Workspace)
- Claim button → `POST /api/v1/alerts/{case_id}/claim`
- Bulk clear → select rows → confirmation modal → dry-run call → confirmed
  call with `confirmation_token` (never a single-click bulk action)
- Filters/search are client-state driving query params on the GET call
  — do not implement client-side filtering of a fully-loaded dataset;
  this list can grow large, filter server-side

## States
- Empty (filtered to zero results): show "no alerts match these
  filters," not a generic empty state
- Row past SLA: red timer + subtle row highlight
- Unassigned vs. claimed: visually distinct assignee cell

## Acceptance criteria
- [ ] Sorting/reordering never happens automatically mid-session (no
      live re-sort while an analyst is scrolled into the list) — only
      on explicit filter/sort action
- [ ] Agent recommendation is never the default selected state of any
      action control on this screen
