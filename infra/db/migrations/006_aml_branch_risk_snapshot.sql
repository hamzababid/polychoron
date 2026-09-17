-- specs/suites/bfsi/features/aml-detection/screens/01-dashboard.md:
-- "IRAR heat-map -> separate aggregation by branch/product, not yet in
-- genosai_case_models.py - add a BranchRiskSnapshot model if this
-- needs its own data source rather than deriving live". Minimally
-- scoped: branch-level open-case counts by risk tier, recomputed
-- ("snapshotted") each time the Dashboard is loaded rather than on a
-- schedule — Phase 2's real Model Governance/Reporting layer owns
-- genuine periodic snapshotting. Owned (writes) by app-api.

CREATE TABLE aml_branch_risk_snapshots (
    branch_code        TEXT NOT NULL,
    risk_tier          TEXT NOT NULL CHECK (risk_tier IN ('critical', 'high', 'medium', 'low')),
    open_case_count    INTEGER NOT NULL,
    snapshot_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (branch_code, risk_tier)
);
