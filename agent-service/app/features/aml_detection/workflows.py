"""The AML Detection Temporal workflow. Per
specs/platform/03-agent-framework-spec.md and
specs/suites/bfsi/features/aml-detection/agent-implementation.md:
Evidence Gathering -> Pattern Matching -> Case & Narrative ->
human-checkpoint signal wait -> resume on Disposition.

Workflow code stays free of non-workflow-safe imports (no DB/HTTP
clients here, only activity calls) per Temporal's determinism
requirements — see activities.py for where the actual node execution
happens."""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from app.features.aml_detection.activities import (
        case_narrative_activity,
        evidence_gathering_activity,
        pattern_matching_activity,
    )

_LLM_ACTIVITY_TIMEOUT = timedelta(minutes=3)


@workflow.defn(name="AmlDetectionWorkflow")
class AmlDetectionWorkflow:
    def __init__(self) -> None:
        self._disposition: dict | None = None

    @workflow.signal(name="disposition")
    def disposition(self, payload: dict) -> None:
        """Sent by app-api's disposition endpoint when an officer
        records a Disposition in Case Workspace — the human-checkpoint
        resume described in
        specs/platform/09-backend-service-boundary-spec.md."""
        self._disposition = payload

    @workflow.run
    async def run(self, alert: dict) -> dict:
        case_id = alert["case_ref"]
        tenant_id = alert["tenant_id"]

        evidence = await workflow.execute_activity(
            evidence_gathering_activity,
            {"alert": alert, "tenant_id": tenant_id, "case_id": case_id},
            start_to_close_timeout=timedelta(minutes=1),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        typology_match = await workflow.execute_activity(
            pattern_matching_activity,
            {"evidence": evidence, "tenant_id": tenant_id, "case_id": case_id},
            start_to_close_timeout=_LLM_ACTIVITY_TIMEOUT,
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        assessment = await workflow.execute_activity(
            case_narrative_activity,
            {
                "evidence": evidence,
                "typology_match": typology_match,
                "account_ids": alert.get("account_ids", []),
                "tenant_id": tenant_id,
                "case_id": case_id,
            },
            start_to_close_timeout=_LLM_ACTIVITY_TIMEOUT,
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # Human checkpoint: a workflow pause on a signal, not a
        # completed-then-restarted execution (agent-framework-spec.md
        # non-negotiable #2) — full workflow context (evidence,
        # typology_match, assessment) is preserved by Temporal while
        # waiting, for however long the officer takes.
        await workflow.wait_condition(lambda: self._disposition is not None)

        return {
            "evidence": evidence,
            "typology_match": typology_match,
            "assessment": assessment,
            "disposition": self._disposition,
        }
