# Screen spec: Typology & Rules Console
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** `typology-rules-console.*`
**Route:** `/admin/typologies`
**RBAC:** `mlro_compliance_head` (full, including promote), `model_risk_audit` (read-only)

## Data source
`GET /api/v1/typologies`, `GET /api/v1/typologies/{code}/history`,
`POST /api/v1/typologies/{code}/backtest`,
`POST /api/v1/typologies/{code}/promote`

## Component → data binding
- Rule table → typology configs with computed metrics
  (`alert_volume_30d`, `str_conversion_rate`, `false_positive_rate`)
  — compute these from `Case`/`Disposition` records grouped by
  `typology_code`, don't hand-maintain them
- Detail/edit panel → plain-language rule logic description +
  version history from the typology's change log
- Backtest/shadow section → poll the async backtest job started by
  `POST /api/v1/typologies/{code}/backtest`; render before/after
  comparison once complete
- Promote action → confirmation-gated, calls
  `POST /api/v1/typologies/{code}/promote`

## Interactions
- Toggling active/inactive is itself a change requiring the same
  version-history logging as a rule-logic edit

## States
- **Live vs. draft must be visually unmistakable** — this is the same
  design principle as the agent-vs-officer distinction on Case
  Workspace, applied to configuration state. A rule currently affecting
  production alerts should never look visually identical to one still
  in backtesting.
- Backtest running: show job status (queued/running/complete), not a
  static spinner with no progress indication

## Acceptance criteria
- [ ] `promote` endpoint is unreachable by any role except
      `mlro_compliance_head`
- [ ] Every promotion logs which backtest job (if any) it was promoted
      from — a promotion with no linked backtest should be flagged,
      not silently allowed
