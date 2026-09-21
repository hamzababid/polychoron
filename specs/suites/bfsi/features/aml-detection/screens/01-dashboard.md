# Screen spec: Command Dashboard
**PHASE: 1 (MVP demo core)**

**Claude Design reference file:** `dashboard.*` (attach export here)
**Route:** `/dashboard`
**RBAC (Phase 1 demo stub):** visible to both DemoRole.ANALYST and DemoRole.COMPLIANCE_OFFICER — full role gating (mlro_compliance_head, model_risk_audit, etc.) is a Phase 3 concern, see phase-3-enterprise/rbac-spec.md

## Data source
**Phase 1 build note (see TASKS.md's "ADDITIVE — Dashboard Trend
Widgets"):** the parameterized `GET .../reports/summary?period=&compare_previous=`
this section originally specified is Phase 2 Reporting & MI scope and
doesn't exist yet. Built instead against two fixed-window endpoints on
the same `DashboardController`/`DashboardService` that endpoint will
eventually wrap (so both stay the same computation by construction,
never separately-maintained numbers — the acceptance criterion below):
- `GET .../reports/summary-basic` — the four top-line stat-card figures
  plus the branch risk heat-map
- `GET .../reports/summary-trends` — the last-6-months trend chart,
  disposition breakdown, and most-aging-alerts list

## Component → data binding
- Stat cards (open alerts by tier, STR/CTR volume, aging count) →
  aggregate counts from `Case` table grouped by `status`/risk tier
- Trend chart → monthly time series from `Case.created_at`: alerts
  raised, STR filed count, STR conversion rate, false-positive rate
- Agent-vs-human split → computed from `Disposition.overrides_agent_recommendation`
  ratio over the period. **Built as a 2-way split** (agreed with agent
  / overrode agent), not the 3-way split an earlier Design mockup
  showed — this system has no distinct low-friction "agent-cleared,
  officer signed off" path separate from full manual review; every
  disposition goes through the same Case Workspace form, so a 3rd
  category would have to be invented rather than computed
- False-positive trend → `Case` count where `disposition_type == CLEAR`
  and `assessment.recommendation` was `escalate`/`recommend_str`, over time
- Aging alerts list → top 3 `Case` rows where SLA threshold exceeded,
  `status` still open, ordered by SLA remaining ascending
- IRAR heat-map → **deferred, not Phase 1/1.5 scope.** This is a
  periodic human-assessed artifact (branch × risk-type, scored during
  an MLRO/compliance IRAR review cycle), not a computation over case
  data — there's nothing in `Case`/`Disposition` to derive it from.
  Belongs under Model Governance & Audit (Phase 2) once that owns a
  real input workflow for it, not a placeholder here.

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
