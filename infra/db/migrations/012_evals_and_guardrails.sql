-- specs/platform/11-evals-and-guardrails-framework.md
-- ADDITIVE to the in-progress build: new platform-level tables only,
-- plus additive/defaulted columns on aml_evidence_bundles (guardrail
-- G2/G6 markers — agent-service already owns writes to that table,
-- same pattern as 009's regulatory_citations addition).

CREATE TABLE platform_guardrail_violations (
    violation_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            TEXT NOT NULL REFERENCES tenants (tenant_id),
    suite_code            TEXT NOT NULL REFERENCES suites (suite_code),
    feature_code          TEXT NOT NULL REFERENCES features (feature_code),
    external_case_ref      TEXT NOT NULL,
    guardrail_type          TEXT NOT NULL
                                CHECK (guardrail_type IN (
                                    'evidence_completeness', 'prompt_injection_filter',
                                    'citation_fabrication_check', 'schema_validation',
                                    'confidence_routing', 'pii_redaction', 'kill_switch'
                                )),
    node_name                TEXT NOT NULL,
    severity                  TEXT NOT NULL CHECK (severity IN ('blocked', 'flagged', 'escalated')),
    details                    TEXT NOT NULL,
    detected_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX platform_guardrail_violations_case_idx ON platform_guardrail_violations (external_case_ref);
CREATE INDEX platform_guardrail_violations_tenant_idx ON platform_guardrail_violations (tenant_id, feature_code);

-- G5: routing thresholds as stored config rather than a hardcoded
-- prompt constant. Phase 1 ships the table + a hardcoded fallback
-- default in the reader (no CRUD screen yet — same "minimal is fine"
-- discipline TASKS.md applies to the kill switch UI).
CREATE TABLE platform_confidence_routing_policies (
    tenant_id             TEXT NOT NULL REFERENCES tenants (tenant_id),
    feature_code           TEXT NOT NULL REFERENCES features (feature_code),
    typology_code           TEXT NOT NULL,
    escalate_below            DOUBLE PRECISION NOT NULL CHECK (escalate_below >= 0 AND escalate_below <= 1),
    high_confidence_above     DOUBLE PRECISION NOT NULL CHECK (high_confidence_above >= 0 AND high_confidence_above <= 1),
    updated_by                 TEXT NOT NULL REFERENCES platform_users (user_id),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, feature_code, typology_code)
);

-- G6: kill switch scopes. typology_code IS NULL means the entire
-- feature is disabled for that tenant. Only rows with
-- reactivated_at IS NULL are currently active.
CREATE TABLE platform_kill_switch_scopes (
    scope_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             TEXT NOT NULL REFERENCES tenants (tenant_id),
    feature_code           TEXT NOT NULL REFERENCES features (feature_code),
    typology_code           TEXT,
    disabled_by               TEXT NOT NULL REFERENCES platform_users (user_id),
    disabled_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason                       TEXT NOT NULL,
    reactivated_at                TIMESTAMPTZ,
    reactivated_by                 TEXT REFERENCES platform_users (user_id)
);

CREATE INDEX platform_kill_switch_scopes_active_idx
    ON platform_kill_switch_scopes (tenant_id, feature_code)
    WHERE reactivated_at IS NULL;

CREATE TABLE platform_golden_dataset_cases (
    case_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code              TEXT NOT NULL REFERENCES features (feature_code),
    scenario_name               TEXT NOT NULL,
    input_evidence_fixture         JSONB NOT NULL,
    expected_typology                TEXT,
    expected_recommendation             TEXT,
    expected_confidence_min                DOUBLE PRECISION,
    expected_confidence_max                DOUBLE PRECISION,
    tags                                     TEXT[] NOT NULL DEFAULT '{}',
    created_by                                TEXT NOT NULL REFERENCES platform_users (user_id),
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (feature_code, scenario_name)
);

CREATE INDEX platform_golden_dataset_cases_feature_idx ON platform_golden_dataset_cases (feature_code);

CREATE TABLE platform_eval_runs (
    run_id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code                 TEXT NOT NULL REFERENCES features (feature_code),
    agent_version_under_test       TEXT NOT NULL,
    triggered_by                     TEXT NOT NULL REFERENCES platform_users (user_id),
    started_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                         TIMESTAMPTZ,
    total_cases                            INTEGER NOT NULL,
    passed                                    INTEGER NOT NULL DEFAULT 0,
    failed                                      INTEGER NOT NULL DEFAULT 0,
    faithfulness_score_avg                        DOUBLE PRECISION,
    consistency_variance                            DOUBLE PRECISION,
    status                                            TEXT NOT NULL DEFAULT 'running'
                                                          CHECK (status IN ('running', 'passed', 'failed', 'needs_review'))
);

CREATE INDEX platform_eval_runs_feature_idx ON platform_eval_runs (feature_code, started_at DESC);

CREATE TABLE platform_eval_case_results (
    result_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                    UUID NOT NULL REFERENCES platform_eval_runs (run_id),
    golden_case_id              UUID NOT NULL REFERENCES platform_golden_dataset_cases (case_id),
    actual_typology                TEXT,
    actual_recommendation             TEXT,
    actual_confidence                   DOUBLE PRECISION,
    matched_expected                       BOOLEAN NOT NULL,
    notes                                     TEXT
);

CREATE INDEX platform_eval_case_results_run_idx ON platform_eval_case_results (run_id);

CREATE TABLE platform_fairness_monitoring_snapshots (
    snapshot_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 TEXT NOT NULL REFERENCES tenants (tenant_id),
    feature_code                 TEXT NOT NULL REFERENCES features (feature_code),
    period_start                    TIMESTAMPTZ NOT NULL,
    period_end                        TIMESTAMPTZ NOT NULL,
    segment_dimension                   TEXT NOT NULL,
    segment_value                          TEXT NOT NULL,
    str_recommendation_rate                   DOUBLE PRECISION NOT NULL,
    false_positive_rate                          DOUBLE PRECISION NOT NULL,
    baseline_deviation                              DOUBLE PRECISION NOT NULL,
    flagged                                            BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX platform_fairness_snapshots_lookup_idx
    ON platform_fairness_monitoring_snapshots (tenant_id, feature_code, period_end DESC);

-- Guardrail G2 (evidence completeness gate) — additive, defaulted;
-- existing rows and existing code paths that don't know about these
-- fields are unaffected.
ALTER TABLE aml_evidence_bundles ADD COLUMN data_gaps JSONB NOT NULL DEFAULT '[]';
ALTER TABLE aml_evidence_bundles ADD COLUMN evidence_incomplete BOOLEAN NOT NULL DEFAULT false;

-- Guardrail G6 marker: set true when the feature-wide kill switch was
-- active and Pattern Matching/Case & Narrative were skipped for this
-- case — lives here (not on aml_cases, which app-api owns writes to)
-- because aml_evidence_bundles is the last row agent-service actually
-- writes before short-circuiting.
ALTER TABLE aml_evidence_bundles ADD COLUMN kill_switch_active BOOLEAN NOT NULL DEFAULT false;
