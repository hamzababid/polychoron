-- specs/platform/05-rbac-platform-spec.md defines two kinds of roles:
-- platform-level (platform.sys_admin, platform.model_risk_audit,
-- platform.external_examiner — "meaningful across every suite/feature,
-- not owned by any one feature") and feature-level
-- (aml_detection.analyst_l1 etc.). Phase 1's platform_roles table only
-- anticipated the feature-level kind (feature_code NOT NULL). Needed
-- now: Typology Console and Model Governance gate on
-- platform.model_risk_audit / platform.external_examiner.
-- NULL feature_code = platform-level, cross-feature role.

ALTER TABLE platform_roles ALTER COLUMN feature_code DROP NOT NULL;
