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
    choice, called via LangChain's ChatOpenAI (specs/platform/
    03-agent-framework-spec.md's "LangGraph nodes ... inside a Temporal
    workflow" pattern uses LangChain for the LLM call itself, not just
    LangGraph for orchestration). Phase 1's only real implementation;
    see specs/platform/08-model-inference-routing-spec.md, "What this
    means for Phase 1". The router and every PlatformAgentNode only
    ever see the InferenceClient interface (complete(prompt, system=)),
    so which vendor sits behind FOUNDATION_API — and which SDK/library
    is used to call it — is a swap contained entirely to this class."""

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
        # langchain_openai's client to touch the network.
        from langchain_openai import ChatOpenAI

        self._client = ChatOpenAI(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            # Low, not zero: this is a compliance-adjacent workflow where
            # run-to-run consistency matters (demo reliability, audit-log
            # comparability) more than creative variation, but a hard 0
            # isn't meaningfully more deterministic for most providers
            # and forecloses provider-side sampling improvements.
            temperature=0.2,
        )

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        from langchain_core.messages import HumanMessage, SystemMessage

        messages: list[SystemMessage | HumanMessage] = []
        if system:
            messages.append(SystemMessage(content=system))
        messages.append(HumanMessage(content=prompt))

        response = self._client.invoke(messages)
        content = response.content
        return content if isinstance(content, str) else str(content)


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
