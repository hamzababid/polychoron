-- specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
-- Replaces Phase 1's hardcoded, in-repo
-- agent-service/app/features/aml_detection/typology_catalog.py as the
-- Pattern Matching Agent's "typology config lookup" tool — Phase 1
-- anticipated this swap explicitly. Owned (writes) by app-api (the
-- console's own screen); agent-service reads it for pattern matching.

CREATE TABLE aml_typology_configs (
    typology_code           TEXT PRIMARY KEY,
    typology_label           TEXT NOT NULL,
    rule_logic_description   TEXT NOT NULL,
    active                   BOOLEAN NOT NULL DEFAULT true,
    production_version       INTEGER NOT NULL DEFAULT 1,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only — every edit *and* every active/inactive toggle writes a
-- row here (screen spec: "toggling active/inactive is itself a change
-- requiring the same version-history logging as a rule-logic edit").
CREATE TABLE aml_typology_config_versions (
    version_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    typology_code        TEXT NOT NULL REFERENCES aml_typology_configs (typology_code),
    version               INTEGER NOT NULL,
    rule_logic_description TEXT NOT NULL,
    active                 BOOLEAN NOT NULL,
    changed_by             TEXT NOT NULL REFERENCES platform_users (user_id),
    changed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_reason          TEXT NOT NULL,
    UNIQUE (typology_code, version)
);

CREATE INDEX aml_typology_config_versions_code_idx ON aml_typology_config_versions (typology_code);

CREATE TABLE aml_typology_backtest_jobs (
    job_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    typology_code      TEXT NOT NULL REFERENCES aml_typology_configs (typology_code),
    status              TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'running', 'complete', 'failed')),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    comparison_report    JSONB
);

CREATE INDEX aml_typology_backtest_jobs_code_idx ON aml_typology_backtest_jobs (typology_code);

CREATE TABLE aml_typology_promotions (
    promotion_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    typology_code       TEXT NOT NULL REFERENCES aml_typology_configs (typology_code),
    promoted_version     INTEGER NOT NULL,
    -- Nullable, but a promotion with no linked backtest must be
    -- visibly flagged in the UI, never silently allowed
    -- (screens/06-typology-rules-console.md acceptance criteria).
    backtest_job_id       UUID REFERENCES aml_typology_backtest_jobs (job_id),
    promoted_by            TEXT NOT NULL REFERENCES platform_users (user_id),
    promoted_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_typology_promotions_code_idx ON aml_typology_promotions (typology_code);
