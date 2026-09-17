-- Model inference routing. Source: specs/platform/08-model-inference-routing-spec.md
-- Owned entirely by agent-service (Python) — app-api never reads or
-- writes this table, since it never calls an LLM (boundary spec, "What
-- does NOT change").

CREATE TABLE tenant_inference_profiles (
    tenant_id                TEXT PRIMARY KEY REFERENCES tenants (tenant_id),
    deployment_model         TEXT NOT NULL CHECK (deployment_model IN ('on_prem', 'private_cloud', 'shared_saas')),
    data_residency_required  BOOLEAN NOT NULL,
    network_egress_approved  BOOLEAN NOT NULL,
    allowed_providers        TEXT[] NOT NULL,
    default_provider         TEXT NOT NULL CHECK (default_provider IN ('self_hosted_oss', 'foundation_api')),
    overrides                JSONB NOT NULL DEFAULT '[]',
    approved_by              TEXT NOT NULL,
    approved_at              TIMESTAMPTZ NOT NULL,

    -- Mirrors TenantInferenceProfile.validate_consistency() at the data
    -- layer, so an inconsistent profile can never be persisted even by
    -- a bug in application code (spec non-negotiable #2).
    CONSTRAINT tenant_inference_profiles_residency_check CHECK (
        NOT (data_residency_required AND 'foundation_api' = ANY (allowed_providers))
    ),
    CONSTRAINT tenant_inference_profiles_egress_check CHECK (
        NOT (NOT network_egress_approved AND default_provider = 'foundation_api')
    )
);
