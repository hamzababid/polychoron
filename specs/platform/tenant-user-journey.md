# Polychoron AI — Tenant User Journey
### How this actually gets used, day to day, per tenant. Cross-reference this when building screens so the sequence of real events matches what's built, not just the individual screen specs in isolation.

## 0. Tenant onboarding (one-time)
- A `Tenant` record is created: `enabled_suites=["bfsi"]`,
  `enabled_features=["aml_detection"]`
- A `TenantInferenceProfile` is set based on this bank's actual
  data-residency clearance (see `08-model-inference-routing-spec.md`)
- The AML Detection role manifest is applied — named users assigned
  `aml_detection.analyst_l1` / `senior_officer_l2` / `mlro_compliance_head`
- The shared regulatory corpus (AMLA/SBP/FMU) is platform content,
  already available — not re-ingested per tenant
- This tenant's own typology thresholds (via `ConfidenceRoutingPolicy`
  and the Typology & Rules Console) are configured
- Everything from here on is scoped to `tenant_id` — cross-tenant data
  access is impossible by construction, not just by policy

## 1. The analyst's day (`aml_detection.analyst_l1`)
- Opens Alert Queue — cases the bank's TMS flagged overnight, already
  agent-triaged
- A case flagged `evidence_incomplete=True` (guardrail G2) sits at the
  top, distinct from normally-scored cases
- Claims a case, opens Case Workspace — sees agent evidence, the
  typology match with inline regulatory citations (clickable through to
  the actual retrieved passage), and the agent's confidence
- A case with confidence below this typology's `escalate_below`
  threshold lands as "Escalate," not a forced STR recommendation —  the
  analyst is the one applying judgment on ambiguous cases
- Investigates, documents, disposes — files, escalates, or clears with
  a documented reason

## 2. The senior officer's day (`aml_detection.senior_officer_l2`)
- Reviews a high-confidence, agent-recommended STR case
- Filing Console: pre-populated fields, agent-drafted narrative
  (clearly labeled), edits for precision
- Attestation panel — tipping-off checklist and named sign-off, submit
  stays disabled until both are complete
- Submits; goAML Tracker shows the filing move from Submitted to
  Acknowledged

## 3. What happens invisibly, for every case either of them touches
- Every agent call writes a tagged, audited log entry, including which
  inference provider served it
- A scheduled sampling job pulls a slice of this period's agent-cleared
  cases (not just the ones analysts flagged) for secondary human review
  — feeding the agreement-rate metric
- The fairness eval is quietly checking segment-level rates in the
  background; nothing surfaces to the analyst or officer unless it
  trips a threshold for the MLRO

## 4. The MLRO's week (`aml_detection.mlro_compliance_head`)
- Reviews Model Governance & Audit: agreement rate, consistency across
  branches, any fairness flags, any golden-dataset regression failures
  from recent changes
- Notices a typology's false-positive rate drifting up; adjusts its
  config in Typology & Rules Console, runs golden-dataset regression
  first (fast, cheap), then shadow mode (slower, live comparison)
  before promoting
- Generates the SBP bi-annual STR summary from Reporting & MI

## 5. The exception journey — a guardrail actually firing
- A fairness flag surfaces: one occupation category's STR-recommendation
  rate has drifted well above baseline with no corresponding rise in
  actual confirmed-suspicious outcomes
- The MLRO investigates, decides the underlying typology needs review
  before processing more live cases
- Uses the **kill switch** — disables that specific typology tenant-wide.
  New alerts matching it route straight to full manual review, agent
  untouched, until she's satisfied and reactivates it
- This action is logged: who, when, why, and — on reactivation — by
  whom and when

## What's shared across every tenant vs. what varies

| Shared (platform-level) | Varies (tenant-specific) |
|---|---|
| Regulatory corpus content | Inference profile (self-hosted vs. API) |
| Agent framework mechanics | Which users hold which roles |
| Guardrail logic (injection defense, citation validation, schema checks) | Typology thresholds actually in force |
| Eval harness mechanics | Fairness-monitoring baselines (each tenant's own "normal") |
| | Every case, evidence record, and filing — fully isolated by `tenant_id` |
