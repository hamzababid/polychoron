-- AML Detection feature tables (BFSI suite). Source:
-- specs/suites/bfsi/features/aml-detection/data-models.py
-- Phase 1 scope only (Case, EvidenceBundle, TypologyMatch,
-- CaseAssessment, Disposition, STRFiling) — SamplingReview is Phase 2
-- (Model Governance & Audit) and is deliberately not created yet
-- (constitution rule 9, phase discipline).
--
-- Table ownership (writes) per specs/platform/09-backend-service-boundary-spec.md:
--   app-api (NestJS):       aml_cases (status/assignment), aml_dispositions, aml_str_filings
--   agent-service (Python): aml_evidence_bundles, aml_typology_matches, aml_case_assessments
-- Both services read freely across this line.

CREATE TABLE aml_cases (
    case_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            TEXT NOT NULL REFERENCES tenants (tenant_id),
    -- InboundAlert is immutable once received and 1:1 with the case
    -- that was created from it, so it is embedded rather than given
    -- its own table.
    alert                JSONB NOT NULL,
    status               TEXT NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'claimed', 'investigating', 'cleared', 'escalated', 'pending_filing', 'filed')),
    assigned_analyst_id  TEXT REFERENCES platform_users (user_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at            TIMESTAMPTZ
);

CREATE INDEX aml_cases_status_idx ON aml_cases (status);
CREATE INDEX aml_cases_tenant_idx ON aml_cases (tenant_id);
-- The bank TMS's own alert id must not be ingested twice as separate cases.
CREATE UNIQUE INDEX aml_cases_source_alert_idx ON aml_cases (((alert ->> 'source_alert_id')));

CREATE TABLE aml_evidence_bundles (
    case_id               UUID PRIMARY KEY REFERENCES aml_cases (case_id),
    kyc                   JSONB NOT NULL,
    transaction_timeline  JSONB NOT NULL DEFAULT '[]',
    linked_entities       JSONB NOT NULL DEFAULT '[]',
    prior_cases           JSONB NOT NULL DEFAULT '[]',
    screening_results     JSONB NOT NULL DEFAULT '[]',
    assembled_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent_version         TEXT NOT NULL
);

CREATE TABLE aml_typology_matches (
    case_id                    UUID PRIMARY KEY REFERENCES aml_cases (case_id),
    typology_code              TEXT NOT NULL,
    typology_label              TEXT NOT NULL,
    confidence                  DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    matched_indicators           JSONB NOT NULL DEFAULT '[]',
    plain_language_rationale     TEXT NOT NULL,
    matched_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent_version                TEXT NOT NULL
);

CREATE TABLE aml_case_assessments (
    case_id                    UUID PRIMARY KEY REFERENCES aml_cases (case_id),
    risk_score                 INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    recommendation              TEXT NOT NULL CHECK (recommendation IN ('clear', 'escalate', 'recommend_str', 'recommend_ctr')),
    recommendation_confidence   DOUBLE PRECISION NOT NULL CHECK (recommendation_confidence >= 0 AND recommendation_confidence <= 1),
    draft_narrative              TEXT NOT NULL,
    -- STRFieldsDraft has no suspicion-rationale field by construction
    -- (constitution-addendum A1) — enforced at the Pydantic/DTO layer
    -- on both services, not re-derivable from this JSONB column alone.
    str_fields_draft             JSONB,
    assessed_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent_version                TEXT NOT NULL
);

CREATE TABLE aml_dispositions (
    case_id                          UUID PRIMARY KEY REFERENCES aml_cases (case_id),
    officer_id                       TEXT NOT NULL REFERENCES platform_users (user_id),
    disposition_type                 TEXT NOT NULL CHECK (disposition_type IN ('clear', 'enhanced_monitoring', 'escalate_senior', 'file_str', 'file_ctr')),
    officer_notes                    TEXT NOT NULL,
    overrides_agent_recommendation   BOOLEAN NOT NULL DEFAULT false,
    override_reason                  TEXT,
    decided_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constitution rule 4: overrides require reasons, enforced at the
    -- data layer, not just UI validation.
    CONSTRAINT aml_dispositions_override_reason_required CHECK (
        NOT overrides_agent_recommendation OR override_reason IS NOT NULL
    )
);

CREATE TABLE aml_str_filings (
    filing_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id              UUID NOT NULL REFERENCES aml_cases (case_id),
    report_type          TEXT NOT NULL CHECK (report_type IN ('str_f', 'ctr', 'ctr_a', 'str_a')),
    payload              JSONB NOT NULL,
    final_narrative      TEXT NOT NULL,
    attestation          JSONB NOT NULL,
    submission_status    TEXT NOT NULL DEFAULT 'draft'
                             CHECK (submission_status IN ('draft', 'submitted', 'acknowledged', 'feedback_received')),
    goaml_reference       TEXT,
    submitted_at          TIMESTAMPTZ,
    acknowledged_at       TIMESTAMPTZ,
    -- Constitution addendum A3: computed server-side at submission time
    -- (submitted_at + 10 years), never recalculated client-side.
    retention_expiry      TIMESTAMPTZ
);

CREATE UNIQUE INDEX aml_str_filings_case_idx ON aml_str_filings (case_id);
