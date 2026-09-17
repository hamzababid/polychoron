# Screen spec: Admin & Access Control
**PHASE: 3 (enterprise readiness)**

**Claude Design reference file:** `admin-access-control.*`
**Route:** `/admin/users`
**RBAC:** `sys_admin`
**This entire screen and the auth system behind it is built fresh in Phase 3 — it replaces the Phase 1 `DemoUser`/`DemoSession` stub completely.**

## Data source
New user/role tables built in this phase (see
`phase-3-enterprise/rbac-spec.md`), backed by real OIDC/SAML
authentication.

## Component → data binding
- User/role table → real user records + role assignments from the
  Phase 3 role set (`analyst_l1`, `senior_officer_l2`,
  `mlro_compliance_head`, `model_risk_audit`, `sys_admin`,
  `external_examiner`)
- Role toggles per row → role-assignment endpoint (define alongside the
  Phase 3 API contract, not yet written — add
  `phase-3-enterprise/api-contracts-phase3.md` when this phase starts)
- Time-boxed examiner access → distinct action generating an
  auto-expiring credential with a visible expiry, not a standing role
  grant

## Explicit non-goals for this screen
- No case content, evidence, or filing data is ever visible here —
  `sys_admin` must be structurally unable to reach it
- Real password/MFA/session-management flows are part of the OIDC/SAML
  provider integration, not built as custom logic in this app

## Migration note from Phase 1
The Phase 1 demo stub (`DemoUser`, `DemoSession`, `DemoRole` in
`02-data-models.py`) is discarded, not extended, when this phase
starts. Do not attempt to gradually evolve the demo stub into
production auth — replace it cleanly so no demo-only shortcuts leak
into the real system.

## Acceptance criteria
- [ ] No trace of the Phase 1 demo-login endpoint remains reachable
      once Phase 3 auth is live
- [ ] `sys_admin` role is verified (via test) to receive 403 on every
      case/evidence/filing endpoint
- [ ] Examiner credentials are visibly time-boxed in the UI (expiry
      shown, not just enforced silently on the backend)
