# Screen spec: Reporting & MI
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** `reporting-mi.*`
**Route:** `/reports`
**RBAC:** `mlro_compliance_head`

## Data source
`GET /api/v1/reports/summary`, `POST /api/v1/reports/generate`,
`GET /api/v1/reports/history`

## Component → data binding
- Period/compare controls → drive query params on the summary endpoint
- Summary metrics row → STR/CTR volume, avg time-to-file, SLA adherence
  — reuse the same computation the Dashboard uses (single source of
  truth, see `01-dashboard.md` acceptance criteria)
- Volume trend, SLA breakdown, agent-workload split → time-series
  charts from the same aggregation
- Export section → `POST /api/v1/reports/generate`, async job; list
  previously generated reports from `GET /api/v1/reports/history`

## Interactions
- "Generate report" with format selector (PDF / SBP bi-annual summary
  format) — confirm the exact SBP submission format/template with
  compliance before hardcoding a layout; this is a regulatory
  deliverable, not a generic export

## States
- Report generation in progress: show job status, don't block the rest
  of the screen while a report renders

## Acceptance criteria
- [ ] Every figure on this screen matches the Dashboard's figures for
      the same period exactly — if they diverge, that's a bug, not an
      acceptable "different view" difference
- [ ] Generated reports are retained and re-downloadable, not
      regenerated fresh each time (a report used in a Board deck or
      SBP submission should be reproducible byte-for-byte later)
