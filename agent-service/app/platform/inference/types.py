"""Mirrors specs/platform/08-model-inference-routing-spec.md and
specs/platform/02-platform-data-models.py exactly. This is the single
source of truth for these shapes inside agent-service — app-api never
needs them, since it never calls an LLM (boundary spec)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class InferenceProvider(str, Enum):
    SELF_HOSTED_OSS = "self_hosted_oss"
    FOUNDATION_API = "foundation_api"


class TenantDeploymentModel(str, Enum):
    ON_PREM = "on_prem"
    PRIVATE_CLOUD = "private_cloud"
    SHARED_SAAS = "shared_saas"


class InferenceOverrideScope(BaseModel):
    feature_code: str
    node_name: str | None = None
    provider: InferenceProvider
    reason: str
    approved_by: str
    approved_at: datetime


class TenantInferenceProfile(BaseModel):
    tenant_id: str
    deployment_model: TenantDeploymentModel
    data_residency_required: bool
    network_egress_approved: bool
    allowed_providers: list[InferenceProvider]
    default_provider: InferenceProvider
    overrides: list[InferenceOverrideScope] = Field(default_factory=list)
    approved_by: str
    approved_at: datetime

    def validate_consistency(self) -> None:
        if self.data_residency_required and InferenceProvider.FOUNDATION_API in self.allowed_providers:
            raise ValueError(
                "data_residency_required=True is incompatible with "
                "FOUNDATION_API in allowed_providers — this tenant profile "
                "would be self-contradictory"
            )
        if not self.network_egress_approved and self.default_provider == InferenceProvider.FOUNDATION_API:
            raise ValueError(
                "default_provider cannot be FOUNDATION_API without an "
                "approved network egress path"
            )
        for o in self.overrides:
            if o.provider == InferenceProvider.FOUNDATION_API and (
                self.data_residency_required or not self.network_egress_approved
            ):
                raise ValueError(
                    f"override for {o.feature_code}/{o.node_name} requests "
                    f"FOUNDATION_API but this tenant cannot use it"
                )
