# Screen spec: Sanctions & PEP Screening Hub
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** `screening-hub.*`
**Route:** `/screening`
**RBAC:** `analyst_l1` (dispositions on hits), `senior_officer_l2`, `mlro_compliance_head`

## Data source
`GET /api/v1/screening/hits?status=held`

## Component → data binding
- Queue row: severity badge → `ScreeningResult` confidence-derived tier
  (define thresholds: e.g. ≥0.9 = high/red, 0.6–0.89 = amber); matched
  name/source → `list_source`, `matched_name`; rationale → `match_rationale`
- Row quick-actions ("true match — freeze" / "false match — release" /
  "escalate") → `POST /api/v1/screening/hits/{hit_id}/disposition`
- Detail panel: side-by-side customer vs. watchlist comparison — needs
  the customer's own field values alongside the watchlist entry's
  fields; highlight matching fields specifically (not just show both
  lists side by side unstyled)

## Interactions
- True-match action triggers a TFS freeze — this calls into core
  banking (out of scope for this spec; confirm the actual freeze
  endpoint with the bank integration team before building, do not stub
  this as a no-op in a way that could ship to production silently)

## States
- This queue should visually communicate urgency — held transactions
  are paused pending the decision. Consider a live "time held" counter
  per row, not just a static timestamp.

## Acceptance criteria
- [ ] The two opposing quick-actions (freeze vs. release) are visually
      distinct enough that mis-click risk is minimized — this was
      flagged in design review as the platform's single highest-
      consequence UI risk; do not ship this screen without a second
      person reviewing the action-button layout specifically
- [ ] Every disposition here writes an audit entry with officer
      identity, even for "false match — release"
