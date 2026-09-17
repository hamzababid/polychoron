# Polychoron AI — Model Inference Routing Spec
### Platform-level. Every agent node in every feature calls this router — none call an LLM SDK directly.

## The problem this solves
Different tenants will have different constraints on where inference can
run: a design-partner bank still finalizing SBP approval may require
zero data egress (self-hosted open-weight model only); a bank with an
approved outsourcing arrangement may permit a foundation model API for
better reasoning quality. This can also vary **within** a tenant, by
feature or even by individual agent node — e.g. a tenant might permit
foundation-API inference for AML's Case & Narrative agent (where
reasoning/writing quality matters most) while requiring self-hosted
inference for a simpler classification-style node.

This must be resolved by configuration, at runtime, per call — never
hardcoded per node, and never decided by the node's own code.

## Core data model additions (add to `platform/02-platform-data-models.py`)

```python
class InferenceProvider(str, Enum):
    SELF_HOSTED_OSS = "self_hosted_oss"   # vLLM-served open-weight model,
                                            # inside the tenant's own boundary
    FOUNDATION_API = "foundation_api"      # e.g. Claude via Anthropic API
                                            # or an approved regional endpoint


class TenantDeploymentModel(str, Enum):
    ON_PREM = "on_prem"            # fully inside the bank's own data center
    PRIVATE_CLOUD = "private_cloud"  # SBP-approved local CSP, dedicated tenant env
    SHARED_SAAS = "shared_saas"      # Polychoron-hosted multi-tenant


class InferenceOverrideScope(BaseModel):
    """A narrower rule than the tenant default — e.g. 'this tenant's
    AML Detection feature's Case & Narrative node specifically may use
    the foundation API, even though the tenant default is self-hosted.'"""
    feature_code: str
    node_name: Optional[str] = None  # None = applies to the whole feature
    provider: InferenceProvider
    reason: str
    approved_by: str
    approved_at: datetime


class TenantInferenceProfile(BaseModel):
    """One per tenant. This is the single source of truth the router
    resolves against — never a config value read from inside agent code."""
    tenant_id: str
    deployment_model: TenantDeploymentModel

    # The compliance/legal answer: has this tenant's risk committee
    # signed off that customer data may leave their environment at all?
    data_residency_required: bool

    # The physical/network answer: even if compliance permits it, does
    # this deployment actually have an approved, verified egress path to
    # reach an external API? These are deliberately separate fields —
    # an on-prem, air-gapped deployment can have
    # data_residency_required=False on paper and still have no way to
    # reach a foundation API.
    network_egress_approved: bool

    allowed_providers: list[InferenceProvider]
    default_provider: InferenceProvider
    overrides: list[InferenceOverrideScope] = Field(default_factory=list)

    approved_by: str  # who at the tenant/bank signed off on this profile
    approved_at: datetime

    def validate_consistency(self) -> None:
        """Call this on every write, not just at read time — a profile
        that fails this check must never be persisted."""
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
```

## Resolution logic (the router itself)

```python
def resolve_inference_provider(
    tenant_id: str, feature_code: str, node_name: str
) -> InferenceProvider:
    profile = get_tenant_inference_profile(tenant_id)  # fetch from store

    for override in profile.overrides:
        if override.feature_code == feature_code and override.node_name in (node_name, None):
            provider = override.provider
            break
    else:
        provider = profile.default_provider

    if provider not in profile.allowed_providers:
        # Defensive check — validate_consistency() should have caught
        # this at write time, but the router fails closed regardless.
        raise RuntimeError(
            f"Resolved provider {provider} is not in tenant {tenant_id}'s "
            f"allowed_providers — refusing to call an LLM. This must never "
            f"silently fall back to a different provider."
        )
    return provider


def get_inference_client(tenant_id: str, feature_code: str, node_name: str):
    """What every PlatformAgentNode actually calls — never an LLM SDK
    directly. Returns a client conforming to one common interface
    (e.g. .complete(prompt) -> str) regardless of underlying provider,
    so agent node code never branches on which provider it got."""
    provider = resolve_inference_provider(tenant_id, feature_code, node_name)
    if provider == InferenceProvider.SELF_HOSTED_OSS:
        return SelfHostedInferenceClient(tenant_id)  # points at this
                                                        # tenant's vLLM endpoint
    else:
        return FoundationAPIInferenceClient(tenant_id)  # Anthropic API /
                                                           # regional endpoint
```

## Non-negotiables for this router
1. **Fail closed, never fail open.** If a tenant's profile is missing,
   ambiguous, or fails `validate_consistency()`, the router must refuse
   to return a client rather than defaulting to whichever provider seems
   "safer" or "cheaper" — an unresolvable config is a configuration bug
   to fix, not a runtime decision to guess at.
2. **`validate_consistency()` runs on every write to a
   `TenantInferenceProfile`**, not just as a periodic audit — a
   self-contradictory profile must never be persisted in the first
   place.
3. **Every inference call logs which provider actually served it.** Add
   a `model_provider: InferenceProvider` field to
   `PlatformAgentActivityLogEntry` — this makes "which provider handled
   this specific case" an audit fact, not an inference from config.
4. **Overrides are logged with `approved_by`/`approved_at`**, same
   discipline as a typology rule promotion — this is a decision that
   changes where a bank's customer data goes, it needs the same
   accountability trail as a filing decision.
5. **The router is a platform capability, called the same way by every
   feature.** AML Detection's nodes call `get_inference_client(...)`
   exactly like a future Fraud Detection feature's nodes would — no
   feature builds its own inference-selection logic.

## What this means for Phase 1 (the demo)
For the investor demo, seed a single `TenantInferenceProfile` for the
demo tenant with `deployment_model=SHARED_SAAS`,
`data_residency_required=False`, `network_egress_approved=True`,
`default_provider=FOUNDATION_API` — i.e., use Claude via API for the
demo, since reasoning/narrative quality matters most for a convincing
demo and there's no real bank data-residency constraint yet. Do not
build the self-hosted vLLM path for Phase 1 — build the router
abstraction itself (so the interface is correct from day one), but the
actual `SelfHostedInferenceClient` implementation can be a stub that
raises "not yet implemented" until a design-partner bank's requirements
make it necessary. This mirrors the same phasing discipline used
elsewhere in this project: build the extensible interface early, defer
the harder implementation until it's actually needed.
