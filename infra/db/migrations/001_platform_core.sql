-- Platform-level tables shared across every suite and feature.
-- Source: specs/platform/02-platform-data-models.py
-- Table ownership (writes) per specs/platform/09-backend-service-boundary-spec.md:
--   app-api (NestJS):      suites, features, tenants, platform_roles,
--                          platform_users, platform_sessions
--   agent-service (Python): platform_agent_activity_log
-- feature_case_envelopes is written by whichever service creates the
-- feature's case (Phase 1: app-api, since Case creation happens in
-- app-api's ingestion endpoint).
-- Both services may read any table freely.

CREATE TABLE suites (
    suite_code   TEXT PRIMARY KEY,
    suite_name   TEXT NOT NULL,
    description  TEXT NOT NULL
);

CREATE TABLE features (
    feature_code       TEXT PRIMARY KEY,
    feature_name       TEXT NOT NULL,
    suite_code         TEXT NOT NULL REFERENCES suites (suite_code),
    description        TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('planned', 'beta', 'ga')),
    role_manifest_ref  TEXT NOT NULL
);

CREATE TABLE tenants (
    tenant_id        TEXT PRIMARY KEY,
    tenant_name      TEXT NOT NULL,
    enabled_suites   TEXT[] NOT NULL DEFAULT '{}',
    enabled_features TEXT[] NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_case_envelopes (
    envelope_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          TEXT NOT NULL REFERENCES tenants (tenant_id),
    suite_code         TEXT NOT NULL REFERENCES suites (suite_code),
    feature_code       TEXT NOT NULL REFERENCES features (feature_code),
    external_case_ref  TEXT NOT NULL,
    status             TEXT NOT NULL,
    risk_tier          TEXT,
    summary_title      TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (feature_code, external_case_ref)
);

CREATE INDEX feature_case_envelopes_tenant_idx ON feature_case_envelopes (tenant_id);

-- The immutable, platform-shaped audit log every agent node invocation
-- writes to (constitution rule 3 and rule 11). This is the single
-- source of truth for agent activity across every feature — a
-- feature's own "activity log" screen queries this table filtered by
-- feature_code/external_case_ref rather than maintaining its own copy.
CREATE TABLE platform_agent_activity_log (
    log_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             TEXT NOT NULL REFERENCES tenants (tenant_id),
    suite_code            TEXT NOT NULL REFERENCES suites (suite_code),
    feature_code          TEXT NOT NULL REFERENCES features (feature_code),
    external_case_ref     TEXT NOT NULL,
    agent_name            TEXT NOT NULL,
    agent_version         TEXT NOT NULL,
    model_provider         TEXT NOT NULL,
    input_payload         JSONB NOT NULL,
    output_payload        JSONB NOT NULL,
    confidence             DOUBLE PRECISION,
    latency_ms             INTEGER NOT NULL,
    data_sources_queried   TEXT[] NOT NULL DEFAULT '{}',
    "timestamp"             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- This table is immutable by convention: application code must never
-- issue UPDATE/DELETE against it. (Enforcing that with a DB trigger is
-- deferred to Phase 3 hardening; Phase 1 relies on both services never
-- doing so.)
CREATE INDEX platform_agent_activity_log_case_idx
    ON platform_agent_activity_log (feature_code, external_case_ref);

CREATE TABLE platform_roles (
    role_code     TEXT PRIMARY KEY,
    feature_code  TEXT NOT NULL REFERENCES features (feature_code),
    display_name  TEXT NOT NULL,
    description   TEXT NOT NULL
);

CREATE TABLE platform_users (
    user_id       TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants (tenant_id),
    display_name  TEXT NOT NULL,
    email         TEXT NOT NULL,
    role_codes    TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE platform_sessions (
    session_id  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES platform_users (user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ
);
