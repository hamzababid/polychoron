"""Temporal activities, one per node of the AML agent chain — each
calls run_graph_step() to advance the case's langgraph.StateGraph
(see graph.py) exactly one node. Node code itself does I/O and DB
writes (HTTP calls to mock-bank, SQL reads/writes) which must never
run directly inside workflow code — Temporal activities are the
sanctioned place for that per the SDK's determinism model. Domain
output persistence (save_evidence_bundle etc.) happens inside the
graph's node functions; the audit-log write
(platform_agent_activity_log) happens automatically inside
PlatformAgentNode.run() itself, so neither is duplicated here.

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

from app.features.aml_detection.graph import run_graph_step


@activity.defn
def evidence_gathering_activity(payload: dict) -> dict:
    result = run_graph_step(
        payload["case_id"],
        initial_state={
            "alert": payload["alert"],
            "tenant_id": payload["tenant_id"],
            "case_id": payload["case_id"],
            "account_ids": payload["alert"].get("account_ids", []),
        },
    )
    return result["evidence"]


@activity.defn
def pattern_matching_activity(payload: dict) -> dict:
    result = run_graph_step(payload["case_id"])
    return result["typology_match"]


@activity.defn
def case_narrative_activity(payload: dict) -> dict:
    result = run_graph_step(payload["case_id"])
    return result["assessment"]


ALL_ACTIVITIES = [evidence_gathering_activity, pattern_matching_activity, case_narrative_activity]
