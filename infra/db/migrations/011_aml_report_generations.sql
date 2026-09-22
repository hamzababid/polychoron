-- Reporting & MI (specs/suites/bfsi/features/aml-detection/screens/10-reporting-mi.md)
-- "Generated reports are retained and re-downloadable, not
-- regenerated fresh each time" — the file content itself is persisted
-- (bytea), not just a description of how to rebuild it.
--
-- Phase 2 scope decision (phase-2-full-aml/api-contracts-phase2.md):
-- CSV only for now — no PDF library in app-api yet, and no real SBP
-- bi-annual submission template exists to hardcode. format's CHECK
-- constraint intentionally only allows 'csv' today; widen it when a
-- PDF/SBP format is actually built, never claim a format isn't
-- generated.

CREATE TABLE aml_report_generations (
    report_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_name        TEXT NOT NULL,
    period_label        TEXT NOT NULL,
    period_start         TIMESTAMPTZ NOT NULL,
    period_end            TIMESTAMPTZ NOT NULL,
    compare_previous       BOOLEAN NOT NULL DEFAULT false,
    breakdown_by            TEXT NOT NULL CHECK (breakdown_by IN ('type', 'typology', 'branch')),
    format                    TEXT NOT NULL CHECK (format IN ('csv')),
    file_name                  TEXT NOT NULL,
    content_hash                TEXT NOT NULL,
    file_content                  BYTEA NOT NULL,
    generated_by                  TEXT NOT NULL REFERENCES platform_users (user_id),
    generated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_report_generations_generated_at_idx ON aml_report_generations (generated_at DESC);
