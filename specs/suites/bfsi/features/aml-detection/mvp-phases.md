# Polychoron AI — MVP Phase Breakdown

## Why phased this way
The investor demo needs a working, convincing, end-to-end AML loop —
not a broad but shallow platform. Everything that isn't load-bearing
for that demo (real SSO, real bank integration, real goAML connectivity)
is deliberately deferred, mocked, or stubbed in Phase 1.

---

## Phase 1 — AML Core MVP (demo target)

**Goal:** a single user can walk through the entire AML lifecycle live,
in front of investors, with realistic seeded data and no external
dependencies except an LLM API key.

**In scope:**
- Data layer: core `Case`/`Alert`/`Disposition`/`STRFiling` tables
- Agent chain: Evidence Gathering → Pattern Matching → Case & Narrative,
  running against a **mock bank API** (a fixture service simulating
  core banking + KYC responses — not a real bank integration)
- Screens: Alert Queue, Case Workspace, Filing Console, goAML Tracker
  (goAML submission is mocked — simulate the status stepper
  progressing without a real FMU connection), basic Dashboard
- Auth: a single hardcoded demo login (or 2-3 seeded demo users with a
  simple role toggle) — explicitly **not** real SSO/OIDC/SAML
- Seed data: scripted, realistic fictional scenarios (see
  `phase-1-aml-core/seed-data-spec.md`) covering both a positive
  (STR-filed) and negative (cleared) case, matching the scenarios
  already designed in the product spec

**Explicitly out of scope for Phase 1:**
- Real SSO/enterprise identity provider integration
- Real bank core-banking/KYC API integration
- Real goAML/FMU connectivity
- Typology & Rules Console, Sanctions & PEP Hub, Customer 360, Model
  Governance & Audit, Reporting & MI (Phase 2)
- Multi-tenancy, full RBAC, Admin & Access Control (Phase 3)

**Definition of done:** a demo script (see
`phase-1-aml-core/demo-script.md`) can be run start to finish, live,
without errors, on a laptop.

---

## Phase 2 — Full AML Feature Set

**Goal:** complete the AML platform's remaining screens and the
governance/MLOps layer that makes the agent's behavior defensible over
time.

**In scope:**
- Typology & Rules Console (including backtesting/shadow mode)
- Sanctions & PEP Screening Hub
- Customer 360 / Entity View
- Model Governance & Audit (sampling, drift, consistency panels)
- Reporting & MI
- Full MLOps tracing (Langfuse/Phoenix + OpenTelemetry), not just the
  minimal logging used to satisfy Phase 1's audit-log requirement

**Prerequisite:** Phase 1 must be demo-complete first.

---

## Phase 3 — Enterprise Readiness

**Goal:** turn the Phase 1/2 product into something a real bank's IT
security team will approve.

**In scope:**
- Real SSO (OIDC/SAML) integration
- Full RBAC role set (`analyst_l1`, `senior_officer_l2`,
  `mlro_compliance_head`, `model_risk_audit`, `sys_admin`,
  `external_examiner`) — see `phase-3-enterprise/rbac-spec.md`
- Admin & Access Control screen
- Multi-tenancy (if selling to more than one bank)
- Real bank integration adapters (replacing the Phase 1 mock API)
- Real goAML/FMU connectivity

**Prerequisite:** Phase 1 and 2 complete, and ideally a design-partner
bank identified (changes what "real integration" actually needs to
support).
