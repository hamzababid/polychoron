"""The model inference router. Every PlatformAgentNode calls
get_inference_client() from here — never an LLM SDK directly (constitution
rule 11). See specs/platform/08-model-inference-routing-spec.md for the
resolution logic and non-negotiables."""

from __future__ import annotations

from app.platform.inference.clients import (
    FoundationAPIInferenceClient,
    InferenceClient,
    SelfHostedInferenceClient,
)
from app.platform.inference.repository import get_tenant_inference_profile
from app.platform.inference.types import InferenceProvider


class InferenceResolutionError(RuntimeError):
    """Raised whenever the router cannot confidently resolve a provider.
    Non-negotiable #1: fail closed, never fail open — callers must not
    catch this and fall back to a default provider."""


def resolve_inference_provider(tenant_id: str, feature_code: str, node_name: str) -> InferenceProvider:
    profile = get_tenant_inference_profile(tenant_id)

    # validate_consistency() is also enforced on every write (see
    # repository.save_tenant_inference_profile), but re-checking here
    # means a profile written before that enforcement existed, or
    # edited directly in the database, still can't silently violate it.
    profile.validate_consistency()

    provider: InferenceProvider | None = None
    for override in profile.overrides:
        if override.feature_code == feature_code and override.node_name in (node_name, None):
            provider = override.provider
            break
    if provider is None:
        provider = profile.default_provider

    if provider not in profile.allowed_providers:
        raise InferenceResolutionError(
            f"Resolved provider {provider} is not in tenant {tenant_id}'s "
            f"allowed_providers — refusing to call an LLM. This must never "
            f"silently fall back to a different provider."
        )
    return provider


def get_inference_client(tenant_id: str, feature_code: str, node_name: str) -> InferenceClient:
    provider = resolve_inference_provider(tenant_id, feature_code, node_name)
    if provider == InferenceProvider.SELF_HOSTED_OSS:
        return SelfHostedInferenceClient(tenant_id)
    return FoundationAPIInferenceClient(tenant_id)
