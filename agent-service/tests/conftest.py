from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.db import get_connection


@pytest.fixture()
def test_tenant():
    """Seeds a throwaway tenant (+ suite/feature it needs as FKs) for a
    single test, and deletes everything it touched afterward so tests
    stay independent of each other and of demo seed data."""
    tenant_id = f"test-tenant-{uuid.uuid4().hex[:8]}"
    suite_code = "bfsi"
    feature_code = "aml_detection"

    with get_connection() as conn:
        conn.execute(
            text(
                "INSERT INTO suites (suite_code, suite_name, description) "
                "VALUES (:c, :n, :d) ON CONFLICT (suite_code) DO NOTHING"
            ),
            {"c": suite_code, "n": "Banking, Financial Services & Insurance", "d": "test"},
        )
        conn.execute(
            text(
                "INSERT INTO features (feature_code, feature_name, suite_code, description, status, role_manifest_ref) "
                "VALUES (:c, :n, :s, :d, :st, :r) ON CONFLICT (feature_code) DO NOTHING"
            ),
            {
                "c": feature_code,
                "n": "AML Detection & Filing",
                "s": suite_code,
                "d": "test",
                "st": "beta",
                "r": "suites/bfsi/features/aml-detection/role-manifest.md",
            },
        )
        conn.execute(
            text(
                "INSERT INTO tenants (tenant_id, tenant_name, enabled_suites, enabled_features) "
                "VALUES (:t, :n, :es, :ef)"
            ),
            {"t": tenant_id, "n": "Test Tenant", "es": [suite_code], "ef": [feature_code]},
        )
        conn.commit()

    yield {"tenant_id": tenant_id, "suite_code": suite_code, "feature_code": feature_code}

    with get_connection() as conn:
        conn.execute(
            text("DELETE FROM platform_agent_activity_log WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
        conn.execute(
            text("DELETE FROM tenant_inference_profiles WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
        conn.execute(text("DELETE FROM tenants WHERE tenant_id = :t"), {"t": tenant_id})
        conn.commit()


def utcnow():
    return datetime.now(UTC)
