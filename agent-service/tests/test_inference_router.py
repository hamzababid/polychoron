from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.platform.inference.repository import (
    TenantInferenceProfileNotFound,
    save_tenant_inference_profile,
)
from app.platform.inference.router import (
    InferenceResolutionError,
    get_inference_client,
    resolve_inference_provider,
)
from app.platform.inference.types import (
    InferenceOverrideScope,
    InferenceProvider,
    TenantDeploymentModel,
    TenantInferenceProfile,
)


def _profile(tenant_id: str, **overrides) -> TenantInferenceProfile:
    defaults = {
        "tenant_id": tenant_id,
        "deployment_model": TenantDeploymentModel.SHARED_SAAS,
        "data_residency_required": False,
        "network_egress_approved": True,
        "allowed_providers": [InferenceProvider.FOUNDATION_API],
        "default_provider": InferenceProvider.FOUNDATION_API,
        "overrides": [],
        "approved_by": "test-approver",
        "approved_at": datetime.now(UTC),
    }
    return TenantInferenceProfile(**{**defaults, **overrides})


def test_resolves_default_provider(test_tenant):
    save_tenant_inference_profile(_profile(test_tenant["tenant_id"]))
    provider = resolve_inference_provider(test_tenant["tenant_id"], "aml_detection", "evidence_gathering")
    assert provider == InferenceProvider.FOUNDATION_API


def test_node_level_override_wins(test_tenant):
    save_tenant_inference_profile(
        _profile(
            test_tenant["tenant_id"],
            allowed_providers=[InferenceProvider.FOUNDATION_API, InferenceProvider.SELF_HOSTED_OSS],
            overrides=[
                InferenceOverrideScope(
                    feature_code="aml_detection",
                    node_name="pattern_matching",
                    provider=InferenceProvider.SELF_HOSTED_OSS,
                    reason="cheaper classification-style node",
                    approved_by="mlro",
                    approved_at=datetime.now(UTC),
                )
            ],
        )
    )
    assert (
        resolve_inference_provider(test_tenant["tenant_id"], "aml_detection", "pattern_matching")
        == InferenceProvider.SELF_HOSTED_OSS
    )
    # A different node in the same feature is unaffected by the node-scoped override.
    assert (
        resolve_inference_provider(test_tenant["tenant_id"], "aml_detection", "evidence_gathering")
        == InferenceProvider.FOUNDATION_API
    )


def test_fails_closed_when_profile_missing(test_tenant):
    with pytest.raises(TenantInferenceProfileNotFound):
        resolve_inference_provider(test_tenant["tenant_id"], "aml_detection", "evidence_gathering")


def test_resolved_provider_not_in_allowed_list_raises(test_tenant):
    # Bypass save_tenant_inference_profile's validate_consistency() to
    # simulate a row that predates the constraint, proving the router's
    # own defensive check (non-negotiable #1) still catches it.
    import json

    from app.db import get_connection
    from app.platform.inference.repository import _UPSERT_SQL

    with get_connection() as conn:
        conn.execute(
            _UPSERT_SQL,
            {
                "tenant_id": test_tenant["tenant_id"],
                "deployment_model": "shared_saas",
                "data_residency_required": False,
                "network_egress_approved": True,
                "allowed_providers": [InferenceProvider.SELF_HOSTED_OSS.value],
                "default_provider": InferenceProvider.FOUNDATION_API.value,
                "overrides": json.dumps([]),
                "approved_by": "test",
                "approved_at": datetime.now(UTC),
            },
        )
        conn.commit()

    with pytest.raises(InferenceResolutionError):
        resolve_inference_provider(test_tenant["tenant_id"], "aml_detection", "evidence_gathering")


def test_self_hosted_client_raises_not_implemented(test_tenant):
    save_tenant_inference_profile(
        _profile(
            test_tenant["tenant_id"],
            allowed_providers=[InferenceProvider.SELF_HOSTED_OSS],
            default_provider=InferenceProvider.SELF_HOSTED_OSS,
        )
    )
    client = get_inference_client(test_tenant["tenant_id"], "aml_detection", "evidence_gathering")
    with pytest.raises(NotImplementedError):
        client.complete("prompt")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"data_residency_required": True, "allowed_providers": [InferenceProvider.FOUNDATION_API]},
        {"network_egress_approved": False, "default_provider": InferenceProvider.FOUNDATION_API},
    ],
)
def test_validate_consistency_rejects_self_contradictory_profile(test_tenant, kwargs):
    with pytest.raises(ValueError):
        save_tenant_inference_profile(_profile(test_tenant["tenant_id"], **kwargs))
