"""The base contract every feature's agent nodes implement. See
specs/platform/03-agent-framework-spec.md. This is a platform-level
base class (not just a typing Protocol) because the non-negotiable
behaviors — validate-retry-escalate, mandatory audit logging, routing
the LLM call through the model inference router — must actually be
enforced for every node, not just documented as a convention each
feature re-implements.

A feature's concrete node (e.g. AML's Evidence Gathering Agent)
subclasses PlatformAgentNode and implements only `_invoke`, which does
the feature-specific prompting/tool-calling and returns a plain dict.
Everything else (client resolution, schema validation with one retry,
escalation-on-failure, and the immutable activity log write) is
handled once, here, for every feature that will ever exist."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import ClassVar, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ValidationError

from app.platform.activity_log import write_activity_log
from app.platform.inference.clients import InferenceClient
from app.platform.inference.router import get_inference_client
from app.platform.logging import get_logger

logger = get_logger("agent-service.agent_node")

TInput = TypeVar("TInput", bound=BaseModel)
TOutput = TypeVar("TOutput", bound=BaseModel)


class AgentNodeEscalation(Exception):
    """Raised when a node's output fails schema validation twice. The
    caller (the Temporal workflow) must catch this and route
    Case.status = ESCALATED for manual review — per
    agent-implementation.md, malformed data must never be passed
    downstream."""

    def __init__(self, agent_name: str, original_error: Exception) -> None:
        self.agent_name = agent_name
        self.original_error = original_error
        super().__init__(
            f"{agent_name}: output failed schema validation twice — escalating "
            f"to human review rather than proceeding with malformed data "
            f"({original_error})"
        )


class PlatformAgentNode(ABC, Generic[TInput, TOutput]):
    agent_name: ClassVar[str]
    agent_version: ClassVar[str]
    suite_code: ClassVar[str]
    feature_code: ClassVar[str]
    input_schema: ClassVar[type[BaseModel]]
    output_schema: ClassVar[type[BaseModel]]
    tool_allowlist: ClassVar[list[str]] = []

    @abstractmethod
    def _invoke(
        self, input: TInput, tenant_id: str, external_case_ref: str | UUID, client: InferenceClient
    ) -> tuple[dict, list[str]]:
        """Feature-specific logic. Must only use tools in
        tool_allowlist (enforced by the concrete node's own tool
        wiring — this base class does not call tools on the node's
        behalf). Returns (raw_output_dict, data_sources_queried)."""
        raise NotImplementedError

    def run(self, input: TInput, tenant_id: str, external_case_ref: str | UUID) -> TOutput:
        client = get_inference_client(tenant_id, self.feature_code, self.agent_name)
        logger.info(
            "%s v%s invoking via %s for case_id=%s",
            self.agent_name,
            self.agent_version,
            client.provider.value,
            external_case_ref,
        )

        start = time.monotonic()
        raw_output, data_sources_queried = self._invoke(input, tenant_id, external_case_ref, client)
        validated, validation_error = self._try_validate(raw_output)

        if validated is None:
            # Retry once with the same input before escalating — see
            # agent-implementation.md's per-node "On failure" sections.
            logger.warning("%s output failed schema validation, retrying once: %s", self.agent_name, validation_error)
            raw_output, more_sources = self._invoke(input, tenant_id, external_case_ref, client)
            data_sources_queried = list({*data_sources_queried, *more_sources})
            validated, validation_error = self._try_validate(raw_output)

        latency_ms = int((time.monotonic() - start) * 1000)
        confidence = _extract_confidence(raw_output)

        if validated is None:
            logger.error("%s escalating after 2 failed validation attempts: %s", self.agent_name, validation_error)
            # The log entry is still written for the failed attempt —
            # every invocation is audited, successful or not.
            write_activity_log(
                tenant_id=tenant_id,
                suite_code=self.suite_code,
                feature_code=self.feature_code,
                external_case_ref=external_case_ref,
                agent_name=self.agent_name,
                agent_version=self.agent_version,
                model_provider=client.provider.value,
                input_payload=input.model_dump(mode="json"),
                output_payload={"validation_failed": True, "raw_output": raw_output},
                confidence=confidence,
                latency_ms=latency_ms,
                data_sources_queried=data_sources_queried,
            )
            raise AgentNodeEscalation(self.agent_name, validation_error)

        write_activity_log(
            tenant_id=tenant_id,
            suite_code=self.suite_code,
            feature_code=self.feature_code,
            external_case_ref=external_case_ref,
            agent_name=self.agent_name,
            agent_version=self.agent_version,
            model_provider=client.provider.value,
            input_payload=input.model_dump(mode="json"),
            output_payload=validated.model_dump(mode="json"),
            confidence=confidence,
            latency_ms=latency_ms,
            data_sources_queried=data_sources_queried,
        )
        logger.info(
            "%s completed in %dms confidence=%s sources=%s",
            self.agent_name,
            latency_ms,
            confidence,
            ",".join(data_sources_queried) or "none",
        )
        return validated  # type: ignore[return-value]

    def _try_validate(self, raw_output: dict) -> tuple[TOutput | None, ValidationError | None]:
        try:
            return self.output_schema.model_validate(raw_output), None  # type: ignore[return-value]
        except ValidationError as e:
            return None, e


# Different output schemas name their confidence field differently
# (TypologyMatch.confidence vs CaseAssessment.recommendation_confidence)
# — checked in this order so the audit log's dedicated confidence
# column (constitution rule 3) is populated regardless of which node
# produced the output.
_CONFIDENCE_FIELD_NAMES = ("confidence", "recommendation_confidence")


def _extract_confidence(raw_output: object) -> float | None:
    if not isinstance(raw_output, dict):
        return None
    for field_name in _CONFIDENCE_FIELD_NAMES:
        value = raw_output.get(field_name)
        if isinstance(value, (int, float)):
            return float(value)
    return None
