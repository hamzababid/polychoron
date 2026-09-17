# Screen spec: Model Governance & Audit
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** `model-governance-audit.*`
**Route:** `/admin/governance`
**RBAC:** `mlro_compliance_head`, `model_risk_audit`, `external_examiner` (read-only, time-boxed)

## Data source
`GET /api/v1/governance/sampling`, `GET /api/v1/governance/consistency`,
`GET /api/v1/governance/model-versions`

## Component → data binding
- Model version panel → agent_version currently in production per node
  (evidence/pattern/narrative), with change log
- Sampling & drift panel → `SamplingReview` records aggregated: sample
  size, % of agent-cleared alerts sampled, agreement rate trend over
  time. **This is the most important panel on the screen — a drop in
  agreement rate is the platform's primary early-warning signal.**
- Consistency panel → STR conversion rate for a given typology, broken
  out by branch
- Data lineage panel → status list of upstream systems
  (core banking, KYC, sanctions list, prior-case DB) with last-refresh
  timestamps — surface staleness explicitly if any source hasn't
  refreshed recently
- Export action → triggers a governance report generation (reuse the
  Reporting & MI export mechanism if the format overlaps)

## States
- Every number on this screen needs an "as of [timestamp]" label —
  this is an audit screen; unlabeled figures are not acceptable here
  even where they'd be fine elsewhere

## Acceptance criteria
- [ ] `external_examiner` role sees this screen but cannot see live,
      non-sampled case content — verify the sampling data itself
      doesn't leak full case detail beyond what's in the
      `SamplingReview` record
- [ ] Agreement-rate trend is computed from real `SamplingReview` data,
      not a placeholder/mocked series — this number is the one this
      screen exists to make trustworthy
