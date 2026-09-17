# Polychoron AI — Platform Architecture
### Read this before touching any feature-level spec. This defines how the platform stays extensible as more suites and features are added.

## The hierarchy

```
Polychoron AI (platform)
 └── Suite (industry vertical)          e.g. BFSI
      └── Feature (agentic use case)    e.g. AML Detection
           └── Screens, agent chain, data model — all feature-owned
```

- **Platform** provides the things every suite and every feature need
  regardless of domain: authentication/RBAC, the agent orchestration
  framework (the deterministic graph-in-durable-workflow pattern),
  audit logging, tenant management, and the top-level navigation shell.
- **Suite** is an industry vertical grouping (BFSI today; future
  examples might be Healthcare, Public Sector, Telecom — not built yet,
  but the structure must not assume BFSI is the only one). A suite is
  mostly an organizational and navigational concept — it groups related
  features and can carry suite-level branding/terminology, but it does
  not own business logic itself.
- **Feature** is a concrete agentic use case with its own screens, its
  own agent chain, and its own data model extensions. **AML Detection is
  the first feature, under the BFSI suite.** Future BFSI features might
  include Fraud Detection, KYC/Onboarding Automation, or Credit Risk
  Triage — none of these are built yet, but a feature spec added later
  must follow the same shape as AML Detection's.

## What lives at the platform level (build once, every feature reuses it)

1. **Identity, tenancy, and RBAC** (`platform/05-rbac-platform-spec.md`)
   — users, tenants, sessions, and a generic role/permission model.
   Features do not build their own auth; they register **role
   manifests** (see below) that plug into this.
2. **Agent orchestration framework** (`platform/03-agent-framework-spec.md`)
   — the LangGraph-in-Temporal pattern, the audit-logging contract, the
   confidence-based-routing principle, and the shadow-mode/versioning
   discipline. A feature's agent chain is an *instance* of this
   framework, not a reimplementation of it.
3. **Audit & activity log** — the `AgentActivityLogEntry` shape is
   platform-level and tagged with `suite_code`/`feature_code` so a
   future cross-feature governance view is possible without
   reengineering every feature's logging.
4. **Navigation shell** — a suite switcher (top level) and a feature
   switcher (within a suite). Today this shell has exactly one suite
   (BFSI) and one feature (AML Detection) — build the switcher
   component anyway, even with a single option, so adding a second
   feature later is a config change, not a UI rewrite.
5. **Admin & Access Control** (`platform/screens/admin-access-control.md`)
   — platform-wide user/role management, not feature-specific.

## What lives at the feature level (AML Detection is the reference implementation)

Each feature owns:
- Its own data model extensions (AML's `Case`, `EvidenceBundle`, etc. —
  see `suites/bfsi/features/aml-detection/data-models.py`)
- Its own agent chain, implemented against the platform's agent
  framework contracts
- Its own screens
- Its own **role manifest** — the specific roles it needs (e.g. AML's
  `analyst_l1`, `senior_officer_l2`, `mlro_compliance_head`), which the
  platform RBAC system registers and enforces, but which the feature
  defines
- Its own phase plan (a feature can have its own Phase 1/2/3 timeline,
  independent of the platform's own maturity)

## How every `Case`-like entity stays queryable across features later

Even though AML's `Case` model is feature-specific, every feature must
register a lightweight platform-level `FeatureCaseEnvelope` record (see
`platform/02-platform-data-models.py`) for anything it wants visible in
a future cross-feature view (e.g., "all open items across every
feature, for this tenant"). This is a cheap insurance policy: it costs
one extra write per case, and it means a future unified inbox or
cross-feature dashboard doesn't require touching every feature's
internal schema.

## Adding a second feature or a second suite later

See `platform/06-adding-a-new-feature-guide.md` and
`platform/07-adding-a-new-suite-guide.md` — these exist now,
even though there's only one feature and one suite today, specifically
so the pattern is established before it's needed under time pressure.

## What this means for the current MVP build

Nothing about the demo timeline changes. Phase 1 still means "AML
Detection, fully working, demo-ready." The difference is purely
structural: platform-level code (auth stub, agent framework base
classes, navigation shell) is written as platform code from day one,
and AML-specific code lives under
`suites/bfsi/features/aml-detection/` — so when a second feature is
added post-demo, it's additive, not a refactor of AML's code.
