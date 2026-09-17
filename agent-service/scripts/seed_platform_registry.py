"""Seeds the platform registry needed for Phase 1: one Suite (bfsi),
one Feature (aml_detection, status=beta), one demo Tenant, and that
tenant's TenantInferenceProfile (SHARED_SAAS / FOUNDATION_API, per
specs/platform/08-model-inference-routing-spec.md's "What this means
for Phase 1"). Idempotent — safe to re-run.

The demo tenant is a clearly fictional bank name (constitution rule 10,
demo-data honesty).

Usage:
    python scripts/seed_platform_registry.py
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text

from app.db import get_connection
from app.platform.inference.repository import save_tenant_inference_profile
from app.platform.inference.types import (
    InferenceProvider,
    TenantDeploymentModel,
    TenantInferenceProfile,
)

DEMO_TENANT_ID = "demo-northbridge-bank"
DEMO_TENANT_NAME = "Northbridge Bank (Demo)"
SUITE_CODE = "bfsi"
FEATURE_CODE = "aml_detection"


def seed_suite_and_feature() -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO suites (suite_code, suite_name, description)
                VALUES (:code, :name, :desc)
                ON CONFLICT (suite_code) DO UPDATE SET
                    suite_name = EXCLUDED.suite_name,
                    description = EXCLUDED.description
                """
            ),
            {
                "code": SUITE_CODE,
                "name": "Banking, Financial Services & Insurance",
                "desc": "Financial-sector compliance and governance use cases.",
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO features (feature_code, feature_name, suite_code, description, status, role_manifest_ref)
                VALUES (:code, :name, :suite, :desc, :status, :manifest)
                ON CONFLICT (feature_code) DO UPDATE SET
                    feature_name = EXCLUDED.feature_name,
                    suite_code = EXCLUDED.suite_code,
                    description = EXCLUDED.description,
                    status = EXCLUDED.status,
                    role_manifest_ref = EXCLUDED.role_manifest_ref
                """
            ),
            {
                "code": FEATURE_CODE,
                "name": "AML Detection & Filing",
                "suite": SUITE_CODE,
                "desc": (
                    "Agent-assisted AML alert investigation, evidence assembly, "
                    "and regulatory filing preparation. A human compliance "
                    "officer always makes the final suspicion determination."
                ),
                "status": "beta",
                "manifest": "suites/bfsi/features/aml-detection/role-manifest.md",
            },
        )
        conn.commit()
    print(f"Seeded suite={SUITE_CODE!r}, feature={FEATURE_CODE!r}")


def seed_demo_tenant() -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO tenants (tenant_id, tenant_name, enabled_suites, enabled_features)
                VALUES (:id, :name, :suites, :features)
                ON CONFLICT (tenant_id) DO UPDATE SET
                    tenant_name = EXCLUDED.tenant_name,
                    enabled_suites = EXCLUDED.enabled_suites,
                    enabled_features = EXCLUDED.enabled_features
                """
            ),
            {
                "id": DEMO_TENANT_ID,
                "name": DEMO_TENANT_NAME,
                "suites": [SUITE_CODE],
                "features": [FEATURE_CODE],
            },
        )
        conn.commit()
    print(f"Seeded tenant={DEMO_TENANT_ID!r}")


def seed_inference_profile() -> None:
    profile = TenantInferenceProfile(
        tenant_id=DEMO_TENANT_ID,
        deployment_model=TenantDeploymentModel.SHARED_SAAS,
        data_residency_required=False,
        network_egress_approved=True,
        allowed_providers=[InferenceProvider.FOUNDATION_API],
        default_provider=InferenceProvider.FOUNDATION_API,
        overrides=[],
        approved_by="platform-setup-demo",
        approved_at=datetime.now(UTC),
    )
    save_tenant_inference_profile(profile)  # runs validate_consistency() before persisting
    print(f"Seeded TenantInferenceProfile for tenant={DEMO_TENANT_ID!r} (FOUNDATION_API)")


def main() -> None:
    seed_suite_and_feature()
    seed_demo_tenant()
    seed_inference_profile()


if __name__ == "__main__":
    main()
