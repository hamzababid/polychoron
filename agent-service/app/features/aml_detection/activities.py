"""Temporal activities wrapping each PlatformAgentNode. Node code
itself does I/O and DB writes (HTTP calls to mock-bank, SQL reads/
writes) which must never run directly inside workflow code — Temporal
activities are the sanctioned place for that per the SDK's determinism
model. Each activity also persists its node's domain output to the
table agent-service owns (see persistence.py) — the audit-log write
(platform_agent_activity_log) happens automatically inside
PlatformAgentNode.run() itself, so it is not duplicated here.

Known Phase 1 simplification: Node 1's "On failure" partial-evidence
fallback (agent-implementation.md — produce a partial EvidenceBundle
with a data_sources_queried gap noted, rather than fail outright) is
not implemented; Temporal's activity retry policy (see workflows.py)
covers transient upstream failures, but a persistently-unreachable
mock-bank service will fail the activity rather than degrade
gracefully. The mock service has no real-world flakiness, so this
doesn't affect the Phase 1 demo, but it's a real gap before a Phase 3
real-integration swap.
"""

from __future__ import annotations

from temporalio import activity

from app.features.aml_detection.nodes.case_narrative import CaseNarrativeNode
from app.features.aml_detection.nodes.evidence_gathering import EvidenceGatheringNode
from app.features.aml_detection.nodes.pattern_matching import PatternMatchingNode
from app.features.aml_detection.persistence import (
    save_case_assessment,
    save_evidence_bundle,
    save_typology_match,
)
from app.features.aml_detection.schemas import (
    CaseNarrativeInput,
    EvidenceBundle,
    InboundAlert,
)


@activity.defn
def evidence_gathering_activity(payload: dict) -> dict:
    alert = InboundAlert.model_validate(payload["alert"])
    node = EvidenceGatheringNode()
    bundle = node.run(alert, payload["tenant_id"], payload["case_id"])
    save_evidence_bundle(bundle)
    return bundle.model_dump(mode="json")


@activity.defn
def pattern_matching_activity(payload: dict) -> dict:
    evidence = EvidenceBundle.model_validate(payload["evidence"])
    node = PatternMatchingNode()
    match = node.run(evidence, payload["tenant_id"], payload["case_id"])
    save_typology_match(match)
    return match.model_dump(mode="json")


@activity.defn
def case_narrative_activity(payload: dict) -> dict:
    node_input = CaseNarrativeInput.model_validate(
        {
            "evidence": payload["evidence"],
            "typology_match": payload["typology_match"],
            "account_ids": payload["account_ids"],
        }
    )
    node = CaseNarrativeNode()
    assessment = node.run(node_input, payload["tenant_id"], payload["case_id"])
    save_case_assessment(assessment)
    return assessment.model_dump(mode="json")


ALL_ACTIVITIES = [evidence_gathering_activity, pattern_matching_activity, case_narrative_activity]
