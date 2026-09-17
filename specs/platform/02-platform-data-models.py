"""
Polychoron AI — Platform-level data models
These are shared across every suite and feature. Feature-specific models
(e.g. AML's Case, EvidenceBundle) live in each feature's own
data-models.py and COMPOSE with these — they do not redefine them.
"""

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------
# Suite & Feature registry
# ---------------------------------------------------------------------

class FeatureStatus(str, Enum):
    PLANNED = "planned"
    BETA = "beta"
    GA = "ga"


class Suite(BaseModel):
    """An industry vertical grouping. BFSI is the first; this model
    makes no assumption that it's the only one."""
    suite_code: str  # e.g. "bfsi"
    suite_name: str  # e.g. "Banking, Financial Services & Insurance"
    description: str


class Feature(BaseModel):
    """A concrete agentic use case within a suite. AML Detection is the
    first registered feature."""
    feature_code: str  # e.g. "aml_detection"
    feature_name: str  # e.g. "AML Detection & Filing"
    suite_code: str  # foreign key to Suite.suite_code
    description: str
    status: FeatureStatus
    role_manifest_ref: str = Field(
        ..., description="Path to the feature's role manifest, e.g. "
                          "'suites/bfsi/features/aml-detection/role-manifest.md'"
    )


# ---------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------

class Tenant(BaseModel):
    """A customer organization (e.g. one bank). Multi-tenancy is a
    Phase 3 concern for enforcement, but the model exists from day one
    so feature data can be tagged correctly from the start."""
    tenant_id: str
    tenant_name: str
    enabled_suites: list[str] = Field(default_factory=list)  # suite_codes
    enabled_features: list[str] = Field(default_factory=list)  # feature_codes
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------
# Cross-feature case visibility
# ---------------------------------------------------------------------

class FeatureCaseEnvelope(BaseModel):
    """A lightweight, feature-agnostic pointer to a feature's internal
    case/workflow record. Every feature writes one of these per case it
    creates, so a future cross-feature view (e.g. 'everything open for
    this tenant, across all features') is possible without touching
    each feature's internal schema.

    This is intentionally minimal — it is a pointer + summary, not a
    duplicate of the feature's full record."""
    envelope_id: UUID = Field(default_factory=uuid4)
    tenant_id: str
    suite_code: str
    feature_code: str
    external_case_ref: str = Field(
        ..., description="The feature's own case ID, as a string — e.g. "
                          "AML's Case.case_id"
    )
    status: str = Field(..., description="Feature-defined status string, "
                                          "e.g. AML's CaseStatus value")
    risk_tier: Optional[str] = None
    summary_title: str = Field(
        ..., description="Human-readable one-liner for a cross-feature "
                          "list, e.g. 'Structuring — Acc ***4471'"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------
# Platform-level audit logging (features write into this, tagged)
# ---------------------------------------------------------------------

class PlatformAgentActivityLogEntry(BaseModel):
    """The platform-level shape of an agent activity log entry. A
    feature's own agent framework implementation (see each feature's
    agent-implementation.md) must write entries in this shape, with
    suite_code/feature_code populated, so cross-feature governance
    tooling can query one table rather than one per feature."""
    log_id: UUID = Field(default_factory=uuid4)
    tenant_id: str
    suite_code: str
    feature_code: str
    external_case_ref: str
    agent_name: str
    agent_version: str
    model_provider: str = Field(
        ..., description="Which InferenceProvider actually served this call "
                          "— an audited fact, resolved by the model router, "
                          "never inferred from config after the fact."
    )
    input_payload: dict
    output_payload: dict
    confidence: Optional[float] = None
    latency_ms: int
    data_sources_queried: list[str]
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------
# Platform RBAC primitives (full spec in platform/05-rbac-platform-spec.md)
# ---------------------------------------------------------------------

class PlatformRole(BaseModel):
    """A role, namespaced to the feature that defines it. E.g. AML's
    'analyst_l1' is registered as role_code='aml_detection.analyst_l1'
    so role codes never collide across features."""
    role_code: str  # e.g. "aml_detection.analyst_l1"
    feature_code: str
    display_name: str
    description: str


class PlatformUser(BaseModel):
    user_id: str
    tenant_id: str
    display_name: str
    email: str
    role_codes: list[str] = Field(default_factory=list)  # PlatformRole.role_code values


class PlatformSession(BaseModel):
    session_id: str
    user: PlatformUser
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None


# ---------------------------------------------------------------------
# Model inference routing (full spec in platform/08-model-inference-routing-spec.md)
# ---------------------------------------------------------------------

class InferenceProvider(str, Enum):
    SELF_HOSTED_OSS = "self_hosted_oss"
    FOUNDATION_API = "foundation_api"


class TenantDeploymentModel(str, Enum):
    ON_PREM = "on_prem"
    PRIVATE_CLOUD = "private_cloud"
    SHARED_SAAS = "shared_saas"


class InferenceOverrideScope(BaseModel):
    feature_code: str
    node_name: Optional[str] = None
    provider: InferenceProvider
    reason: str
    approved_by: str
    approved_at: datetime


class TenantInferenceProfile(BaseModel):
    """One per tenant — the single source of truth the model router
    resolves against. See platform/08-model-inference-routing-spec.md
    for the resolution logic and non-negotiables."""
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
                "FOUNDATION_API in allowed_providers"
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
