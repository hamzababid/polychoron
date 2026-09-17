# Polychoron AI — Platform RBAC & SSO Spec
### Built once, at the platform level. Features register role manifests against this system — they do not build their own auth.

## Two kinds of roles

**Platform-level roles** — meaningful across every suite/feature, not owned by any one feature:
| Role code | Scope | Can do |
|---|---|---|
| `platform.sys_admin` | Admin & Access Control only | User/role management across all tenants and features. **No access to any case content, evidence, or filings, in any feature.** |
| `platform.model_risk_audit` | Read-only, cross-feature | Agent Activity Log and Model Governance & Audit views across every feature this tenant has enabled. Cannot see live case content unless a specific case is part of a sampling review pool. |
| `platform.external_examiner` | Time-boxed, read-only, cross-feature | Auto-expiring credential, issued via `POST /api/v1/platform/examiner-access`. Every access logged separately from the standard audit log. |

**Feature-level roles** — defined by each feature, namespaced with the
feature code so role names never collide. AML Detection's role
manifest (see
`suites/bfsi/features/aml-detection/role-manifest.md`) registers:

| Role code | Screens visible | Can do |
|---|---|---|
| `aml_detection.analyst_l1` | Alert Queue, Case Workspace (investigate), Customer 360 | Claim alerts, add notes, record disposition up to `enhanced_monitoring`/`escalate_senior`. **Cannot** access Filing Console or submit filings. |
| `aml_detection.senior_officer_l2` | All of `analyst_l1` + Filing Console | Everything above, plus `file_str`/`file_ctr` disposition and filing attestation/submission. |
| `aml_detection.mlro_compliance_head` | All AML screens | Full visibility, Typology & Rules Console promote-to-production rights, Reporting & MI export rights. |

A future second feature (e.g. a hypothetical Fraud Detection feature)
would register its own roles the same way —
`fraud_detection.analyst_l1`, etc. — reusing the same underlying
permission-check mechanism without the platform needing feature-specific
code.

## How a feature registers a role manifest
A feature's `role-manifest.md` (or equivalent config) declares its
roles as `PlatformRole` records (see
`platform/02-platform-data-models.py`) at deployment/startup. The
platform RBAC system is the single source of truth for what's assigned
to which user; the feature only declares what roles exist and what
screens/actions they gate — enforcement of those gates still happens in
the feature's own route handlers, checking against the user's
`role_codes`.

## Enforcement rules
1. Role checks happen server-side on every API call, in every feature —
   never rely on the frontend hiding a button as the only control.
2. `platform.sys_admin` must be structurally incapable of querying
   case/evidence tables in any feature — enforce at the data-access
   layer (e.g. row-level security or a separate service boundary), not
   just at the API-route level.
3. `platform.external_examiner` sessions write an access-log entry on
   every read, separate from the standard audit log.
4. Role escalation (e.g. a user gaining `aml_detection.senior_officer_l2`
   in addition to `aml_detection.analyst_l1`) must be an explicit grant
   by a role with admin rights over that feature — no self-service
   escalation.
5. **Multi-tenancy**: role assignments are scoped per-tenant. A user
   with `aml_detection.analyst_l1` at Tenant A must never be able to
   query Tenant B's cases, even if both tenants have the AML Detection
   feature enabled.

## SSO integration
Real authentication is OIDC/SAML, integrated once at the platform
level. A `PlatformUser`'s `role_codes` are populated either from IdP
group-claim mapping (preferred, if the bank's IdP supports it) or via
the Admin & Access Control screen's manual role assignment — support
both, since not every design-partner bank's IdP will have AML-specific
groups configured on day one.
