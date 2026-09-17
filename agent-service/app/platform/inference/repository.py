"""Persistence for TenantInferenceProfile. validate_consistency() runs
on every write, not just at read time (spec non-negotiable #2) — a
self-contradictory profile must never be persisted."""

from __future__ import annotations

import json

from sqlalchemy import text

from app.db import get_connection
from app.platform.inference.types import (
    InferenceOverrideScope,
    InferenceProvider,
    TenantDeploymentModel,
    TenantInferenceProfile,
)


class TenantInferenceProfileNotFound(Exception):
    pass


_SELECT_SQL = text(
    """
    SELECT tenant_id, deployment_model, data_residency_required,
           network_egress_approved, allowed_providers, default_provider,
           overrides, approved_by, approved_at
    FROM tenant_inference_profiles
    WHERE tenant_id = :tenant_id
    """
)

_UPSERT_SQL = text(
    """
    INSERT INTO tenant_inference_profiles (
        tenant_id, deployment_model, data_residency_required,
        network_egress_approved, allowed_providers, default_provider,
        overrides, approved_by, approved_at
    ) VALUES (
        :tenant_id, :deployment_model, :data_residency_required,
        :network_egress_approved, :allowed_providers, :default_provider,
        cast(:overrides as jsonb), :approved_by, :approved_at
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
        deployment_model = EXCLUDED.deployment_model,
        data_residency_required = EXCLUDED.data_residency_required,
        network_egress_approved = EXCLUDED.network_egress_approved,
        allowed_providers = EXCLUDED.allowed_providers,
        default_provider = EXCLUDED.default_provider,
        overrides = EXCLUDED.overrides,
        approved_by = EXCLUDED.approved_by,
        approved_at = EXCLUDED.approved_at
    """
)


def get_tenant_inference_profile(tenant_id: str) -> TenantInferenceProfile:
    with get_connection() as conn:
        row = conn.execute(_SELECT_SQL, {"tenant_id": tenant_id}).mappings().first()
    if row is None:
        raise TenantInferenceProfileNotFound(
            f"No TenantInferenceProfile for tenant_id={tenant_id!r} — "
            f"the router must fail closed rather than guess a default."
        )
    return TenantInferenceProfile(
        tenant_id=row["tenant_id"],
        deployment_model=TenantDeploymentModel(row["deployment_model"]),
        data_residency_required=row["data_residency_required"],
        network_egress_approved=row["network_egress_approved"],
        allowed_providers=[InferenceProvider(p) for p in row["allowed_providers"]],
        default_provider=InferenceProvider(row["default_provider"]),
        overrides=[InferenceOverrideScope(**o) for o in row["overrides"]],
        approved_by=row["approved_by"],
        approved_at=row["approved_at"],
    )


def save_tenant_inference_profile(profile: TenantInferenceProfile) -> None:
    profile.validate_consistency()
    with get_connection() as conn:
        conn.execute(
            _UPSERT_SQL,
            {
                "tenant_id": profile.tenant_id,
                "deployment_model": profile.deployment_model.value,
                "data_residency_required": profile.data_residency_required,
                "network_egress_approved": profile.network_egress_approved,
                "allowed_providers": [p.value for p in profile.allowed_providers],
                "default_provider": profile.default_provider.value,
                "overrides": json.dumps(
                    [o.model_dump(mode="json") for o in profile.overrides]
                ),
                "approved_by": profile.approved_by,
                "approved_at": profile.approved_at,
            },
        )
        conn.commit()
