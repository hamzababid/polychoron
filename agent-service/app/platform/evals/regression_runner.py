"""Eval E1 — golden-dataset regression.
specs/platform/11-evals-and-guardrails-framework.md.

run_golden_dataset_regression() actually invokes the real agent chain
(Pattern Matching, then Case & Narrative when a typology match resulted)
against each GoldenDatasetCase fixture — same PlatformAgentNode classes
production uses, so a passing run means something. Constitution rule 15
("no agent version proceeds to shadow mode without passing golden-
dataset regression") is enforced by
assert_passes_before_shadow_mode(): TASKS.md's own note on the AML
feature's promote() endpoint (typology-console.service.ts) already
documents that Phase 1 doesn't implement real shadow-mode entry yet —
promote() goes straight to production. This function is the actual
gate; it attaches the moment Phase 2 builds a real shadow-mode-entry
action, and is unit-tested here in the meantime so it isn't a stub."""

from __future__ import annotations

from uuid import uuid4

from app.features.aml_detection.nodes.case_narrative import CaseNarrativeNode
from app.features.aml_detection.nodes.pattern_matching import PatternMatchingNode
from app.features.aml_detection.schemas import CaseNarrativeInput, EvidenceBundle
from app.platform.agent_node import AgentNodeEscalation
from app.platform.evals.repository import (
    complete_eval_run,
    create_eval_run,
    latest_eval_run,
    list_golden_dataset_cases,
    write_eval_case_result,
)
from app.platform.evals.types import GoldenDatasetCase
from app.platform.logging import get_logger

logger = get_logger("agent-service.evals.regression_runner")


class GoldenDatasetRegressionRequired(Exception):
    """Raised by assert_passes_before_shadow_mode() — constitution rule
    15. Never catch this to silently proceed; fix the regression or run
    it, then retry."""


def run_golden_dataset_regression(
    *, tenant_id: str, feature_code: str, agent_version_under_test: str, triggered_by: str, tags: list[str] | None = None
) -> dict:
    """tags restricts the run to a subset (e.g. ["adversarial"] for a
    red-team-only pass, per golden-dataset-and-fairness-spec.md's
    cadence table) — omit for the full regression suite."""
    cases = list_golden_dataset_cases(feature_code, tags=tags)
    run_id = create_eval_run(
        feature_code=feature_code,
        agent_version_under_test=agent_version_under_test,
        triggered_by=triggered_by,
        total_cases=len(cases),
    )

    passed = 0
    failed = 0
    for case in cases:
        matched, actual_typology, actual_recommendation, actual_confidence, notes = _run_one_case(case, tenant_id)
        write_eval_case_result(
            run_id=run_id,
            golden_case_id=case.case_id,
            actual_typology=actual_typology,
            actual_recommendation=actual_recommendation,
            actual_confidence=actual_confidence,
            matched_expected=matched,
            notes=notes,
        )
        if matched:
            passed += 1
        else:
            failed += 1

    status = "passed" if failed == 0 and len(cases) > 0 else "failed"
    complete_eval_run(run_id=run_id, passed=passed, failed=failed, status=status)
    logger.info("golden-dataset regression run_id=%s: %d passed, %d failed", run_id, passed, failed)
    return {"run_id": run_id, "total_cases": len(cases), "passed": passed, "failed": failed, "status": status}


def _run_one_case(case: GoldenDatasetCase, tenant_id: str) -> tuple[bool, str | None, str | None, float | None, str | None]:
    fixture_case_id = uuid4()
    try:
        evidence = EvidenceBundle.model_validate(
            {**case.input_evidence_fixture, "case_id": str(fixture_case_id), "agent_version": "golden_dataset_fixture"}
        )
    except Exception as exc:  # noqa: BLE001
        return False, None, None, None, f"fixture failed to validate as EvidenceBundle: {exc}"

    try:
        typology_match = PatternMatchingNode().run(evidence, tenant_id, fixture_case_id)
    except AgentNodeEscalation as exc:
        return False, None, None, None, f"pattern_matching escalated: {exc}"

    actual_recommendation: str | None = None
    actual_confidence: float | None = None
    try:
        assessment = CaseNarrativeNode().run(
            CaseNarrativeInput(evidence=evidence, typology_match=typology_match, account_ids=[]),
            tenant_id,
            fixture_case_id,
        )
        actual_recommendation = assessment.recommendation.value
        actual_confidence = assessment.recommendation_confidence
    except AgentNodeEscalation as exc:
        return (
            False,
            typology_match.typology_code,
            None,
            typology_match.confidence,
            f"case_narrative escalated: {exc}",
        )

    matched = _matches_expectations(case, typology_match.typology_code, actual_recommendation, actual_confidence)
    return matched, typology_match.typology_code, actual_recommendation, actual_confidence, None


def _matches_expectations(
    case: GoldenDatasetCase, actual_typology: str | None, actual_recommendation: str | None, actual_confidence: float | None
) -> bool:
    if case.expected_typology is not None and actual_typology != case.expected_typology:
        return False
    if case.expected_recommendation is not None and actual_recommendation != case.expected_recommendation:
        return False
    if case.expected_confidence_min is not None and (actual_confidence is None or actual_confidence < case.expected_confidence_min):
        return False
    if case.expected_confidence_max is not None and (actual_confidence is None or actual_confidence > case.expected_confidence_max):  # noqa: SIM103 — early-return chain reads clearer than one negated boolean expression
        return False
    return True


def assert_passes_before_shadow_mode(feature_code: str) -> None:
    """Constitution rule 15. Raises GoldenDatasetRegressionRequired
    unless the most recent eval run for this feature has status
    'passed'."""
    run = latest_eval_run(feature_code)
    if run is None or run["status"] != "passed":
        status = run["status"] if run else "no run has ever been executed"
        raise GoldenDatasetRegressionRequired(
            f"{feature_code}: golden-dataset regression must pass before entering shadow mode (current: {status})"
        )
