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

## Sorting, filtering and views (added 2026-09-27 — owner feedback)
The first build had no received date, two single-select filters and a
fixed risk-score order. Standard enterprise work-queue behaviour
instead, still entirely server-side:

**Columns:** Received (date + time, with age) · Alert ID · Customer ·
Typology · Risk · Recommendation · Status · SLA · Assignee.

**Sorting** — click a sortable header to sort; click again to reverse.
Received (default, **newest first**), Risk score, SLA deadline,
Customer, Status. Ties break by received (newest first), then case ID,
so paging is stable. Unscored cases sort last on risk and SLA.

**Guardrail G2 stays enforced:** open cases with incomplete evidence
are pinned above the sorted rows (labelled *evidence incomplete*),
whatever the sort — "must be prioritized in Alert Queue". Closed ones
sort normally.

**Filters** (AND across fields, OR within a multi-select):
- Search: alert ID, customer ID or name, case ID prefix
- Status (multi) · Risk tier (multi, incl. *unscored*) · Typology
  (multi, incl. *no match*) · Recommendation (multi, incl. *none*)
- Assignee: me / unassigned / a named analyst
- Received: today / last 7 days / last 30 days / custom from–to
- SLA: past due / due within 24 h
- Agent state: needs attention (*stalled* or *kill switch*) /
  processing / no agent record

Options for typology and assignee come from
`GET .../alerts/facets` (what actually occurs in cases), so analysts —
who can't read the Typology Console — still get the list.

**Views** — one click presets: *Open work* (default: every status
except cleared/filed, newest first), *My cases*, *Unassigned*, *Past
SLA*, *Needs attention*, *All cases*. Choosing a view replaces the
filters; editing a filter afterwards shows the view as modified.

**State lives in the URL** (shareable, survives refresh, Back works):
each active filter is a removable chip, plus *Clear all* and a result
count.

**New alerts** — every 60 s the screen asks how many cases arrived
after it loaded and shows "N new alerts — show" if any. It never
re-sorts or inserts rows by itself (see acceptance criteria); the
officer chooses when to refresh.

## States
- **Agent state** (added 2026-09-27 — a seeded pre-system case showed
  "processing…" forever): a case without a risk score shows why, from
  app-api's `agent-state.ts` — *processing* (activity within 15 min),
  *agent didn't finish* (started, no assessment — review manually),
  *manual review (kill switch)*, or *no agent record* (closed without
  the agent ever running, e.g. decided before AML Detection existed).
  Never "processing" for a case that can't still be processed.
- Empty (filtered to zero results): show "no alerts match these
  filters," not a generic empty state
- Row past SLA: red timer + subtle row highlight
- Unassigned vs. claimed: visually distinct assignee cell

## Acceptance criteria
- [ ] Default view lists open work newest first, with received date and
      time on every row
- [ ] Every filter and sort is a server-side query parameter, reflected
      in the URL; results page correctly under any sort
- [ ] Open evidence-incomplete cases are pinned first under every sort
- [ ] Sorting/reordering never happens automatically mid-session (no
      live re-sort while an analyst is scrolled into the list) — only
      on explicit filter/sort action
- [ ] Agent recommendation is never the default selected state of any
      action control on this screen
