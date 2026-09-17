# Screen spec: Command Dashboard
**PHASE: 1 (MVP demo core)**

**Claude Design reference file:** `dashboard.*` (attach export here)
**Route:** `/dashboard`
**RBAC (Phase 1 demo stub):** visible to both DemoRole.ANALYST and DemoRole.COMPLIANCE_OFFICER — full role gating (mlro_compliance_head, model_risk_audit, etc.) is a Phase 3 concern, see phase-3-enterprise/rbac-spec.md

## Data source
`GET /api/v1/reports/summary?period=this_month&compare_previous=true`
(reuses the Reporting & MI endpoint at a rolled-up granularity)

## Component → data binding
- Stat cards (open alerts by tier, STR/CTR volume, aging count) →
  aggregate counts from `Case` table grouped by `status`/risk tier
- Trend chart → time series from `Case.created_at` + disposition dates
- Agent-vs-human split → computed from `Disposition.overrides_agent_recommendation`
  ratio over the period
- False-positive trend → `Case` count where `disposition_type == CLEAR`
  and `assessment.recommendation` was `escalate`/`recommend_str`, over time
- Aging alerts list → `Case` where SLA threshold exceeded, `status`
  still open
- IRAR heat-map → separate aggregation by branch/product, not yet in
  `genosai_case_models.py` — add a `BranchRiskSnapshot` model if this
  needs its own data source rather than deriving live

## States
- Empty state: no cases yet (new tenant) — show setup/next-step prompt,
  not a blank grid
- Loading: skeleton tiles, not a spinner over the whole screen

## Interactions
- Every tile/chart click navigates to Alert Queue pre-filtered to match
  (e.g. clicking "critical" tile → `/alerts?risk_tier=critical`)

## Acceptance criteria
- [ ] All figures match what Reporting & MI shows for the same period
      (single source of truth — no separately computed dashboard numbers)
- [ ] Aging-alert card visually distinct (red accent) only when count > 0
