"""Inference clients. Every PlatformAgentNode gets one of these via
get_inference_client() — node code never branches on which provider it
got, and never instantiates an LLM SDK client directly (constitution
rule 11)."""

from __future__ import annotations

from typing import Protocol

from app.config import settings
from app.platform.inference.types import InferenceProvider


class InferenceClient(Protocol):
    provider: InferenceProvider

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        ...


class FoundationAPIInferenceClient:
    """A foundation model API — currently OpenAI, per this deployment's
    choice. Phase 1's only real implementation; see
    specs/platform/08-model-inference-routing-spec.md, "What this means
    for Phase 1". The router and every PlatformAgentNode only ever see
    the InferenceClient interface, so which vendor sits behind
    FOUNDATION_API is a swap contained entirely to this class."""

    provider = InferenceProvider.FOUNDATION_API

    def __init__(self, tenant_id: str) -> None:
        self.tenant_id = tenant_id
        if not settings.openai_api_key:
            raise RuntimeError(
                "FOUNDATION_API was resolved for this call but OPENAI_API_KEY "
                "is not configured — failing closed rather than silently skipping "
                "the LLM call."
            )
        # Imported lazily so the module can be imported (e.g. for tests
        # exercising the router's resolution logic) without requiring
        # the openai package's client to touch the network.
        from openai import OpenAI

        self._client = OpenAI(api_key=settings.openai_api_key)

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = self._client.chat.completions.create(
            model=settings.openai_model,
            # Low, not zero: this is a compliance-adjacent workflow where
            # run-to-run consistency matters (demo reliability, audit-log
            # comparability) more than creative variation, but a hard 0
            # isn't meaningfully more deterministic for most providers
            # and forecloses provider-side sampling improvements.
            temperature=0.2,
            messages=messages,  # type: ignore[arg-type]
        )
        return response.choices[0].message.content or ""


class SelfHostedInferenceClient:
    """Points at this tenant's vLLM endpoint. Deliberately unimplemented
    for Phase 1 — see specs/platform/08-model-inference-routing-spec.md:
    'build the router abstraction itself ... but the actual
    SelfHostedInferenceClient implementation can be a stub that raises
    "not yet implemented" until a design-partner bank's requirements
    make it necessary.' Do not implement this ahead of that need."""

    provider = InferenceProvider.SELF_HOSTED_OSS

    def __init__(self, tenant_id: str) -> None:
        self.tenant_id = tenant_id

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        raise NotImplementedError(
            "SelfHostedInferenceClient is not yet implemented (Phase 1 uses "
            "FOUNDATION_API only). This deliberately fails closed rather than "
            "silently falling back to another provider."
        )
