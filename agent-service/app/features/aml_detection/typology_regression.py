"""TypologyRegressionWorkflow — the Typology Console's promotion gate
(constitution rule 15; screens/06-typology-rules-console.md,
"Promotion gate").

app-api starts it as a background job with a run_id it generated, so it
can poll `GET .../typologies/regression-runs/{run_id}` straight away.
The run's agent_version_under_test is the draft's candidate key; the
promotion guard in migration 014 only accepts a passing run whose key
matches the draft's current content.

One activity per golden case (each makes real LLM calls), so progress
is visible both through the `progress` query and as result rows in
platform_eval_case_results. Case activities don't retry: a failure is
recorded as a failed case, never re-run into a duplicate result row.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from temporalio import activity, workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from sqlalchemy import text

    from app.db import get_connection
    from app.features.aml_detection.typology_candidate import candidate_catalog
    from app.platform.evals.regression_runner import run_one_case
    from app.platform.evals.repository import (
        complete_eval_run,
        create_eval_run,
        list_golden_dataset_cases,
        write_eval_case_result,
    )
    from app.platform.logging import get_logger

logger = get_logger("agent-service.aml_detection.typology_regression")

FEATURE_CODE = "aml_detection"
_PREPARE_TIMEOUT = timedelta(seconds=30)
# A case is two real LLM calls (Pattern Matching + Case & Narrative),
# each with the node's own retry-then-escalate.
_CASE_TIMEOUT = timedelta(minutes=3)
_NO_RETRY = RetryPolicy(maximum_attempts=1)
_RETRY = RetryPolicy(maximum_attempts=3)


@activity.defn
def prepare_typology_regression_activity(payload: dict) -> dict:
    """payload: {run_id, typology_code, version, triggered_by}. Snapshots
    the candidate catalog once, so every case is evaluated against the
    same content even if the draft is edited mid-run (which then just
    makes this run stale)."""
    catalog, candidate_key = candidate_catalog(payload["typology_code"], payload["version"])
    case_ids = [str(c.case_id) for c in list_golden_dataset_cases(FEATURE_CODE)]
    create_eval_run(
        run_id=UUID(payload["run_id"]),
        feature_code=FEATURE_CODE,
        agent_version_under_test=candidate_key,
        triggered_by=payload["triggered_by"],
        total_cases=len(case_ids),
    )
    return {"catalog": catalog, "case_ids": case_ids}


@activity.defn
def run_typology_regression_case_activity(payload: dict) -> bool:
    """payload: {run_id, tenant_id, case_id, catalog}. Returns whether
    the case matched its expectations."""
    case = next(c for c in list_golden_dataset_cases(FEATURE_CODE) if str(c.case_id) == payload["case_id"])
    try:
        matched, typology, recommendation, confidence, notes = run_one_case(
            case, payload["tenant_id"], catalog_override=payload["catalog"]
        )
    except Exception as exc:
        logger.exception("typology regression case %s errored", payload["case_id"])
        matched, typology, recommendation, confidence, notes = False, None, None, None, f"errored: {exc}"
    write_eval_case_result(
        run_id=UUID(payload["run_id"]),
        golden_case_id=case.case_id,
        actual_typology=typology,
        actual_recommendation=recommendation,
        actual_confidence=confidence,
        matched_expected=matched,
        notes=notes,
    )
    return matched


@activity.defn
def complete_typology_regression_activity(run_id: str) -> dict:
    """Tallies from the stored results (not from in-memory counts), so
    the run's verdict is exactly what its result rows say. A run with
    no cases, or with any case missing, fails."""
    with get_connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT r.total_cases,
                       count(c.result_id) FILTER (WHERE c.matched_expected)::int AS passed,
                       count(c.result_id) FILTER (WHERE NOT c.matched_expected)::int AS failed
                FROM platform_eval_runs r
                LEFT JOIN platform_eval_case_results c ON c.run_id = r.run_id
                WHERE r.run_id = :run_id
                GROUP BY r.total_cases
                """
            ),
            {"run_id": run_id},
        ).mappings().one()
    status = "passed" if row["total_cases"] > 0 and row["passed"] == row["total_cases"] else "failed"
    complete_eval_run(run_id=UUID(run_id), passed=row["passed"], failed=row["failed"], status=status)
    return {"status": status, "passed": row["passed"], "failed": row["failed"], "total": row["total_cases"]}


@activity.defn
def fail_typology_regression_activity(run_id: str) -> None:
    """The workflow errored before completing — never leave a run
    `running` forever. No-op if prepare failed before creating it."""
    with get_connection() as conn:
        conn.execute(
            text(
                """
                UPDATE platform_eval_runs SET status = 'failed', completed_at = now()
                WHERE run_id = :run_id AND status = 'running'
                """
            ),
            {"run_id": run_id},
        )
        conn.commit()


@workflow.defn(name="TypologyRegressionWorkflow")
class TypologyRegressionWorkflow:
    """payload: {run_id, typology_code, version, tenant_id, triggered_by}.
    Returns {status, passed, failed, total}."""

    def __init__(self) -> None:
        self._done = 0
        self._total = 0

    @workflow.query
    def progress(self) -> dict:
        return {"done": self._done, "total": self._total}

    @workflow.run
    async def run(self, payload: dict) -> dict:
        try:
            prepared = await workflow.execute_activity(
                prepare_typology_regression_activity,
                payload,
                start_to_close_timeout=_PREPARE_TIMEOUT,
                retry_policy=_NO_RETRY,
            )
            self._total = len(prepared["case_ids"])
            for case_id in prepared["case_ids"]:
                await workflow.execute_activity(
                    run_typology_regression_case_activity,
                    {
                        "run_id": payload["run_id"],
                        "tenant_id": payload["tenant_id"],
                        "case_id": case_id,
                        "catalog": prepared["catalog"],
                    },
                    start_to_close_timeout=_CASE_TIMEOUT,
                    retry_policy=_NO_RETRY,
                )
                self._done += 1
            return await workflow.execute_activity(
                complete_typology_regression_activity,
                payload["run_id"],
                start_to_close_timeout=_PREPARE_TIMEOUT,
                retry_policy=_RETRY,
            )
        except Exception:
            await workflow.execute_activity(
                fail_typology_regression_activity,
                payload["run_id"],
                start_to_close_timeout=_PREPARE_TIMEOUT,
                retry_policy=_RETRY,
            )
            raise


ALL_TYPOLOGY_REGRESSION_ACTIVITIES = [
    prepare_typology_regression_activity,
    run_typology_regression_case_activity,
    complete_typology_regression_activity,
    fail_typology_regression_activity,
]
