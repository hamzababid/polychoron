-- specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md:
-- "FMU follow-up log -> new FMUFollowup records (see 02-api-contracts.md
-- note - this model isn't in genosai_case_models.py yet, add it)".
-- Minimally scoped for Phase 1: a simple, append-only note log per
-- filing, tied to the goAML Tracker's detail panel. Owned (writes) by
-- app-api, same as aml_str_filings.

CREATE TABLE aml_fmu_followups (
    followup_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id    UUID NOT NULL REFERENCES aml_str_filings (filing_id),
    note         TEXT NOT NULL,
    created_by   TEXT NOT NULL REFERENCES platform_users (user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_fmu_followups_filing_idx ON aml_fmu_followups (filing_id);
