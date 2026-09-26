"""DB access for specs/platform/11-evals-and-guardrails-framework.md
PART 2 (golden-dataset regression, fairness monitoring). Writes here
are agent-service's — it's the side that actually runs the agent chain
and computes fairness segments; app-api only reads these tables to
surface them on Model Governance & Audit."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text

from app.db import get_connection
from app.platform.evals.types import FairnessMonitoringSnapshot, GoldenDatasetCase


def seed_golden_dataset_case(case: GoldenDatasetCase) -> UUID:
    """Idempotent on (feature_code, scenario_name) — safe to re-run,
    same discipline as seed-typology-configs.ts."""
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO platform_golden_dataset_cases (
                    case_id, feature_code, scenario_name, input_evidence_fixture,
                    expected_typology, expected_recommendation,
                    expected_confidence_min, expected_confidence_max,
                    tags, created_by, created_at
                ) VALUES (
                    :case_id, :feature_code, :scenario_name, cast(:input_evidence_fixture as jsonb),
                    :expected_typology, :expected_recommendation,
                    :expected_confidence_min, :expected_confidence_max,
                    :tags, :created_by, :created_at
                )
                ON CONFLICT (feature_code, scenario_name) DO UPDATE SET
                    input_evidence_fixture = EXCLUDED.input_evidence_fixture,
                    expected_typology = EXCLUDED.expected_typology,
                    expected_recommendation = EXCLUDED.expected_recommendation,
                    expected_confidence_min = EXCLUDED.expected_confidence_min,
                    expected_confidence_max = EXCLUDED.expected_confidence_max,
                    tags = EXCLUDED.tags
                RETURNING case_id
                """
            ),
            {
                "case_id": str(case.case_id),
                "feature_code": case.feature_code,
                "scenario_name": case.scenario_name,
                "input_evidence_fixture": json.dumps(case.input_evidence_fixture),
                "expected_typology": case.expected_typology,
                "expected_recommendation": case.expected_recommendation,
                "expected_confidence_min": case.expected_confidence_min,
                "expected_confidence_max": case.expected_confidence_max,
                "tags": case.tags,
                "created_by": case.created_by,
                "created_at": datetime.now(UTC),
            },
        )
        case_id = result.scalar_one()
        conn.commit()
        return case_id


def list_golden_dataset_cases(feature_code: str, *, tags: list[str] | None = None) -> list[GoldenDatasetCase]:
    with get_connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT case_id, feature_code, scenario_name, input_evidence_fixture,
                       expected_typology, expected_recommendation,
                       expected_confidence_min, expected_confidence_max,
                       tags, created_by, created_at
                FROM platform_golden_dataset_cases
                WHERE feature_code = :feature_code
                ORDER BY scenario_name
                """
            ),
            {"feature_code": feature_code},
        ).mappings().all()

    cases = [GoldenDatasetCase(**dict(row)) for row in rows]
    if tags:
        cases = [c for c in cases if set(tags) & set(c.tags)]
    return cases


def create_eval_run(*, feature_code: str, agent_version_under_test: str, triggered_by: str, total_cases: int) -> UUID:
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO platform_eval_runs (feature_code, agent_version_under_test, triggered_by, total_cases, status)
                VALUES (:feature_code, :agent_version_under_test, :triggered_by, :total_cases, 'running')
                RETURNING run_id
                """
            ),
            {
                "feature_code": feature_code,
                "agent_version_under_test": agent_version_under_test,
                "triggered_by": triggered_by,
                "total_cases": total_cases,
            },
        )
        run_id = result.scalar_one()
        conn.commit()
        return run_id


def write_eval_case_result(
    *,
    run_id: UUID,
    golden_case_id: UUID,
    actual_typology: str | None,
    actual_recommendation: str | None,
    actual_confidence: float | None,
    matched_expected: bool,
    notes: str | None,
) -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO platform_eval_case_results (
                    run_id, golden_case_id, actual_typology, actual_recommendation,
                    actual_confidence, matched_expected, notes
                ) VALUES (
                    :run_id, :golden_case_id, :actual_typology, :actual_recommendation,
                    :actual_confidence, :matched_expected, :notes
                )
                """
            ),
            {
                "run_id": str(run_id),
                "golden_case_id": str(golden_case_id),
                "actual_typology": actual_typology,
                "actual_recommendation": actual_recommendation,
                "actual_confidence": actual_confidence,
                "matched_expected": matched_expected,
                "notes": notes,
            },
        )
        conn.commit()


def complete_eval_run(*, run_id: UUID, passed: int, failed: int, status: str) -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                UPDATE platform_eval_runs
                SET passed = :passed, failed = :failed, status = :status, completed_at = :completed_at
                WHERE run_id = :run_id
                """
            ),
            {"run_id": str(run_id), "passed": passed, "failed": failed, "status": status, "completed_at": datetime.now(UTC)},
        )
        conn.commit()


def latest_eval_run(feature_code: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT run_id, status, passed, failed, total_cases, completed_at
                FROM platform_eval_runs
                WHERE feature_code = :feature_code
                ORDER BY started_at DESC
                LIMIT 1
                """
            ),
            {"feature_code": feature_code},
        ).mappings().first()
    return dict(row) if row else None


def write_fairness_snapshot(snapshot: FairnessMonitoringSnapshot) -> UUID:
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO platform_fairness_monitoring_snapshots (
                    tenant_id, feature_code, period_start, period_end,
                    segment_dimension, segment_value, str_recommendation_rate,
                    false_positive_rate, baseline_deviation, flagged
                ) VALUES (
                    :tenant_id, :feature_code, :period_start, :period_end,
                    :segment_dimension, :segment_value, :str_recommendation_rate,
                    :false_positive_rate, :baseline_deviation, :flagged
                )
                RETURNING snapshot_id
                """
            ),
            {
                "tenant_id": snapshot.tenant_id,
                "feature_code": snapshot.feature_code,
                "period_start": snapshot.period_start,
                "period_end": snapshot.period_end,
                "segment_dimension": snapshot.segment_dimension,
                "segment_value": snapshot.segment_value,
                "str_recommendation_rate": snapshot.str_recommendation_rate,
                "false_positive_rate": snapshot.false_positive_rate,
                "baseline_deviation": snapshot.baseline_deviation,
                "flagged": snapshot.flagged,
            },
        )
        snapshot_id = result.scalar_one()
        conn.commit()
        return snapshot_id
