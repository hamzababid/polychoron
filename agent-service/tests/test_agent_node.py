from __future__ import annotations

import uuid

import pytest
from pydantic import BaseModel
from sqlalchemy import text

from app.db import get_connection
from app.platform import agent_node as agent_node_module
from app.platform.agent_node import AgentNodeEscalation, PlatformAgentNode, _extract_confidence
from app.platform.inference.types import InferenceProvider


class DummyInput(BaseModel):
    value: str


class DummyOutput(BaseModel):
    value: str
    confidence: float


class _FakeClient:
    provider = InferenceProvider.FOUNDATION_API

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        return "unused"


class DummyNode(PlatformAgentNode[DummyInput, DummyOutput]):
    agent_name = "dummy_node"
    agent_version = "v1"
    suite_code = "bfsi"
    feature_code = "aml_detection"
    input_schema = DummyInput
    output_schema = DummyOutput

    def __init__(self, outputs: list[dict]) -> None:
        self._outputs = outputs
        self.invocations = 0

    def _invoke(self, input, tenant_id, external_case_ref, client):
        raw = self._outputs[self.invocations]
        self.invocations += 1
        return raw, ["dummy_source"]


@pytest.fixture(autouse=True)
def _fake_router(monkeypatch):
    monkeypatch.setattr(agent_node_module, "get_inference_client", lambda *a, **k: _FakeClient())


def test_successful_run_writes_activity_log(test_tenant):
    node = DummyNode(outputs=[{"value": "ok", "confidence": 0.9}])
    case_ref = uuid.uuid4()

    result = node.run(DummyInput(value="in"), test_tenant["tenant_id"], case_ref)

    assert result.value == "ok"
    assert node.invocations == 1

    with get_connection() as conn:
        row = conn.execute(
            text(
                "SELECT agent_name, agent_version, model_provider, confidence, "
                "output_payload FROM platform_agent_activity_log "
                "WHERE external_case_ref = :ref"
            ),
            {"ref": str(case_ref)},
        ).mappings().first()

    assert row is not None
    assert row["agent_name"] == "dummy_node"
    assert row["agent_version"] == "v1"
    assert row["model_provider"] == "foundation_api"
    assert row["confidence"] == pytest.approx(0.9)
    assert row["output_payload"]["value"] == "ok"


def test_retries_once_then_succeeds(test_tenant):
    node = DummyNode(
        outputs=[
            {"value": "bad"},  # missing confidence -> validation error
            {"value": "ok", "confidence": 0.5},
        ]
    )
    case_ref = uuid.uuid4()

    result = node.run(DummyInput(value="in"), test_tenant["tenant_id"], case_ref)

    assert node.invocations == 2
    assert result.value == "ok"


def test_escalates_after_two_failures(test_tenant):
    node = DummyNode(outputs=[{"value": "bad"}, {"value": "still bad"}])
    case_ref = uuid.uuid4()

    with pytest.raises(AgentNodeEscalation):
        node.run(DummyInput(value="in"), test_tenant["tenant_id"], case_ref)

    assert node.invocations == 2

    with get_connection() as conn:
        row = conn.execute(
            text(
                "SELECT output_payload FROM platform_agent_activity_log "
                "WHERE external_case_ref = :ref"
            ),
            {"ref": str(case_ref)},
        ).mappings().first()

    assert row is not None
    assert row["output_payload"]["validation_failed"] is True


@pytest.mark.parametrize(
    ("raw_output", "expected"),
    [
        ({"confidence": 0.8}, 0.8),
        ({"recommendation_confidence": 0.6}, 0.6),
        ({"confidence": 0.8, "recommendation_confidence": 0.6}, 0.8),  # confidence checked first
        ({"draft_narrative": "no confidence field here"}, None),
        (None, None),
        ("not a dict", None),
    ],
)
def test_extract_confidence_checks_both_field_names(raw_output, expected):
    assert _extract_confidence(raw_output) == expected
