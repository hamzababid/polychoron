"""The AML Detection agent chain as a real `langgraph.StateGraph`:
Evidence Gathering -> Pattern Matching -> Case & Narrative, per
specs/platform/03-agent-framework-spec.md ("LangGraph nodes running
inside a Temporal workflow") and agent-implementation.md.

Reconciling a LangGraph graph with Temporal's existing per-node
activity boundaries (see workflows.py / activities.py): each of the
three Temporal activities calls run_graph_step() exactly once. The
graph is compiled with a Postgres-backed checkpointer, keyed by
thread_id=case_id, and interrupt_before=["pattern_matching",
"case_narrative"] — so each invoke() call resumes from the last
completed node and runs exactly one more node before pausing again.
This keeps today's per-node Temporal retry/timeout isolation intact
(a transient failure in node 3 does not re-run node 1's LLM call)
while the chain itself is genuinely LangGraph, not a hand-rolled
sequence of function calls.

Per-node behavior (model inference routing, output-schema validation
with one retry, escalate-on-failure, and the immutable
platform_agent_activity_log write) is unchanged — it still lives in
PlatformAgentNode.run() (see app/platform/agent_node.py); these graph
node functions are thin wrappers that call it and shape the result
into this graph's state.
"""

from __future__ import annotations

import threading
from typing import TypedDict

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.config import settings
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


class AmlGraphState(TypedDict, total=False):
    alert: dict
    tenant_id: str
    case_id: str
    account_ids: list[str]
    evidence: dict
    typology_match: dict
    assessment: dict


def _evidence_gathering_node(state: AmlGraphState) -> dict:
    alert = InboundAlert.model_validate(state["alert"])
    bundle = EvidenceGatheringNode().run(alert, state["tenant_id"], state["case_id"])
    save_evidence_bundle(bundle)
    return {"evidence": bundle.model_dump(mode="json")}


def _pattern_matching_node(state: AmlGraphState) -> dict:
    evidence = EvidenceBundle.model_validate(state["evidence"])
    match = PatternMatchingNode().run(evidence, state["tenant_id"], state["case_id"])
    save_typology_match(match)
    return {"typology_match": match.model_dump(mode="json")}


def _case_narrative_node(state: AmlGraphState) -> dict:
    node_input = CaseNarrativeInput.model_validate(
        {
            "evidence": state["evidence"],
            "typology_match": state["typology_match"],
            "account_ids": state.get("account_ids", []),
        }
    )
    assessment = CaseNarrativeNode().run(node_input, state["tenant_id"], state["case_id"])
    save_case_assessment(assessment)
    return {"assessment": assessment.model_dump(mode="json")}


def _build_graph() -> StateGraph:
    graph = StateGraph(AmlGraphState)
    graph.add_node("evidence_gathering", _evidence_gathering_node)
    graph.add_node("pattern_matching", _pattern_matching_node)
    graph.add_node("case_narrative", _case_narrative_node)
    graph.set_entry_point("evidence_gathering")
    graph.add_edge("evidence_gathering", "pattern_matching")
    graph.add_edge("pattern_matching", "case_narrative")
    graph.add_edge("case_narrative", END)
    return graph


_lock = threading.Lock()
_checkpointer_ctx = None
_compiled_graph: CompiledStateGraph | None = None


def get_compiled_graph() -> CompiledStateGraph:
    """Lazily builds the Postgres checkpointer and compiles the graph
    once per worker process, then reuses it — the checkpointer holds
    its own connection pool, and PostgresSaver.from_conn_string() is a
    context manager meant to stay open for a long-running process, not
    re-entered per call. `.setup()` is idempotent (CREATE TABLE IF NOT
    EXISTS for langgraph's own checkpoint tables) and deliberately not
    routed through infra/db/migrate.py — this is LangGraph's own
    internal, library-versioned state store, not a feature content
    table any other code queries directly."""
    global _checkpointer_ctx, _compiled_graph
    if _compiled_graph is None:
        with _lock:
            if _compiled_graph is None:
                _checkpointer_ctx = PostgresSaver.from_conn_string(settings.database_url)
                checkpointer = _checkpointer_ctx.__enter__()
                checkpointer.setup()
                _compiled_graph = _build_graph().compile(
                    checkpointer=checkpointer,
                    interrupt_before=["pattern_matching", "case_narrative"],
                )
    return _compiled_graph


def run_graph_step(case_id: str, initial_state: AmlGraphState | None = None) -> dict:
    """Runs the graph forward exactly one node from wherever this
    case's checkpoint currently is. The first call (from
    evidence_gathering_activity) passes initial_state; later calls
    pass None so LangGraph resumes from the checkpoint instead of
    restarting the graph from its entry point."""
    graph = get_compiled_graph()
    config = {"configurable": {"thread_id": case_id}}
    return graph.invoke(initial_state, config=config)
