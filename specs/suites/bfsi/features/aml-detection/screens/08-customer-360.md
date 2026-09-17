# Screen spec: Customer 360 / Entity View
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** `customer-360.*`
**Route:** `/customers/{customer_id}`
**RBAC:** `analyst_l1`, `senior_officer_l2`, `mlro_compliance_head`

## Data source
`GET /api/v1/customers/{customer_id}/360`

## Component → data binding
- Identity header → `KYCSnapshot`
- Summary tiles → counts derived from accounts, `PriorCaseSummary` list,
  filing history, current risk score
- Accounts list → account records (not yet modeled in
  `genosai_case_models.py` as a standalone entity — add an `Account`
  model if this needs to be its own queryable list rather than derived
  from `Case.alert.account_ids`)
- Alert/case history → `PriorCaseSummary` list, chronological
- Relationship graph → same component as Case Workspace's linked-entity
  graph, fed from this customer's `LinkedEntity` records across all
  their cases (aggregate, not just one case's evidence)
- Screening history → `ScreeningResult` list across this customer's history

## Interactions
- Reachable from Alert Queue, Case Workspace, and Screening Hub — build
  as a shared linkable route, not a modal, so it's directly bookmarkable
  for audit reference

## States
- No screening history: show explicitly as "no prior sanctions/PEP
  hits," not an empty/missing section — a clean state is meaningful
  information here, not an absence of data

## Acceptance criteria
- [ ] This is a read-only aggregation screen — confirm no write actions
      live here (dispositions/filings happen from Case Workspace/Filing
      Console, not from this screen)
- [ ] Relationship graph component is shared code with Case Workspace,
      not a re-implementation
