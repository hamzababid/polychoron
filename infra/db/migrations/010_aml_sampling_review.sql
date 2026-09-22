-- SamplingReview (specs/suites/bfsi/features/aml-detection/data-models.py)
-- Deliberately deferred from Phase 1's 003_aml_detection_core.sql — see
-- that file's own comment. Added now for Model Governance & Audit
-- (screens/09-model-governance-audit.md): agreement-rate trend over
-- time is "the reason this screen exists," so it must read from real
-- rows here, never a placeholder series.
--
-- Table ownership (writes) per specs/platform/09-backend-service-boundary-spec.md:
-- app-api only — sampling review is a human compliance action, not
-- agent output.

CREATE TABLE aml_sampling_reviews (
    review_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id                UUID NOT NULL REFERENCES aml_cases (case_id),
    original_disposition   TEXT NOT NULL,
    reviewer_id            TEXT NOT NULL REFERENCES platform_users (user_id),
    reviewer_agreed        BOOLEAN NOT NULL,
    reviewer_notes         TEXT,
    reviewed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One sampling review per case — a case selected for the sample gets
-- reviewed once, not repeatedly re-reviewed.
CREATE UNIQUE INDEX aml_sampling_reviews_case_idx ON aml_sampling_reviews (case_id);
