# AML Detection — Role Manifest
### Registered against the platform RBAC system (`platform/05-rbac-platform-spec.md`). This is the feature's own declaration of what roles it needs — the platform enforces them.

| Role code | Display name | Screens | Permissions |
|---|---|---|---|
| `aml_detection.analyst_l1` | AML Analyst | Alert Queue, Case Workspace, Customer 360 | claim_alert, add_case_note, record_disposition (up to enhanced_monitoring/escalate_senior) |
| `aml_detection.senior_officer_l2` | AML Senior Compliance Officer | + Filing Console | + file_str, file_ctr, attest_filing, submit_filing |
| `aml_detection.mlro_compliance_head` | MLRO / Compliance Head | All AML screens | + promote_typology_rule, export_report, view_dashboard |

Feature-specific enforcement notes (in addition to platform RBAC rules):
- `analyst_l1` must receive a 403 on every Filing Console endpoint —
  this is the platform constitution's confidentiality/structural-access
  rule applied to this feature specifically.
- Phase 1's `DemoRole.ANALYST` maps to `aml_detection.analyst_l1` and
  `DemoRole.COMPLIANCE_OFFICER` maps to
  `aml_detection.senior_officer_l2` once Phase 3 replaces the demo
  auth stub — keep this mapping in mind so the Phase 1→3 migration
  doesn't require redesigning the permission boundaries, just
  reattaching them to real roles.
