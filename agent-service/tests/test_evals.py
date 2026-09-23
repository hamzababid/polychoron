"""specs/platform/11-evals-and-guardrails-framework.md PART 2 — golden-
dataset regression (E1) and fairness monitoring (E5). Uses the same
fake-inference-router pattern as test_agent_node.py/test_guardrails.py
so no live LLM key is needed in CI."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.nodes import pattern_matching as pattern_matching_module
from app.platform import agent_node as agent_node_module
from app.platform.evals.fairness import (
    bucket_account_type,
    bucket_occupation_category,
    compute_fairness_snapshot,
)
from app.platform.evals.regression_runner import (
    GoldenDatasetRegressionRequired,
    assert_passes_before_shadow_mode,
    run_golden_dataset_regression,
)
from app.platform.evals.repository import seed_golden_dataset_case
from app.platform.evals.types import GoldenDatasetCase
from app.platform.inference.types import InferenceProvider


class _ScriptedClient:
    provider = InferenceProvider.FOUNDATION_API

    def __init__(self, pattern_match_response: dict, case_narrative_response: dict) -> None:
        self._pattern_match_response = pattern_match_response
        self._case_narrative_response = case_narrative_response

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        import json

        # Pattern Matching's system prompt mentions "typology_code";
        # Case & Narrative's mentions "risk_score" — cheap enough
        # dispatch for a test double without threading node identity
        # through the fake client.
        if system and "risk_score" in system:
            return json.dumps(self._case_narrative_response)
        return json.dumps(self._pattern_match_response)


def _minimal_fixture() -> dict:
    return {
        "kyc": {
            "customer_name": "Eval Fixture Customer",
            "cnic": "00000-0000000-0",
            "declared_occupation": "Salaried Employee",
            "declared_monthly_turnover": 100_000.0,
            "kyc_risk_rating": "medium",
            "account_opening_date": "2020-01-01T00:00:00Z",
            "address": "Test Address",
        },
        "transaction_timeline": [],
        "linked_entities": [],
        "prior_cases": [],
        "screening_results": [],
        "data_gaps": [],
    }


@pytest.fixture()
def golden_cases(test_tenant, test_user):
    prefix = f"test-eval-{uuid.uuid4().hex[:8]}"
    passing = GoldenDatasetCase(
        feature_code=test_tenant["feature_code"],
        scenario_name=f"{prefix}-passing",
        input_evidence_fixture=_minimal_fixture(),
        expected_typology="structuring_subthreshold",
        expected_recommendation="recommend_str",
        expected_confidence_min=0.5,
        tags=[prefix],
        created_by=test_user,
    )
    failing = GoldenDatasetCase(
        feature_code=test_tenant["feature_code"],
        scenario_name=f"{prefix}-failing",
        input_evidence_fixture=_minimal_fixture(),
        expected_typology="deposit_velocity_shift",  # will not match the scripted response below
        expected_recommendation="recommend_str",
        tags=[prefix],
        created_by=test_user,
    )
    seed_golden_dataset_case(passing)
    seed_golden_dataset_case(failing)

    yield [passing, failing]

    with get_connection() as conn:
        conn.execute(text("DELETE FROM platform_eval_case_results WHERE golden_case_id IN (:p, :f)"), {"p": str(passing.case_id), "f": str(failing.case_id)})
        conn.execute(text("DELETE FROM platform_golden_dataset_cases WHERE case_id IN (:p, :f)"), {"p": str(passing.case_id), "f": str(failing.case_id)})
        conn.commit()


def test_run_golden_dataset_regression_tallies_pass_and_fail(test_tenant, test_user, golden_cases, monkeypatch):
    scripted_client = _ScriptedClient(
        pattern_match_response={
            "typology_code": "structuring_subthreshold",
            "typology_label": "Structuring",
            "confidence": 0.85,
            "matched_indicators": [],
            "plain_language_rationale": "Deposits clustered under the threshold.",
            "cited_chunk_ids": [],
        },
        case_narrative_response={
            "risk_score": 80,
            "recommendation": "recommend_str",
            "recommendation_confidence": 0.85,
            "draft_narrative": "Three deposits under threshold within hours.",
        },
    )
    monkeypatch.setattr(agent_node_module, "get_inference_client", lambda *a, **k: scripted_client)
    monkeypatch.setattr(pattern_matching_module, "retrieve_regulatory_context", lambda **kwargs: [])

    result = run_golden_dataset_regression(
        tenant_id=test_tenant["tenant_id"],
        feature_code=test_tenant["feature_code"],
        agent_version_under_test="test-v1",
        triggered_by=test_user,
        tags=[golden_cases[0].tags[0]],
    )

    assert result["total_cases"] == 2
    assert result["passed"] == 1
    assert result["failed"] == 1
    assert result["status"] == "failed"  # one failing case fails the whole run

    with get_connection() as conn:
        row = conn.execute(
            text("SELECT status, passed, failed FROM platform_eval_runs WHERE run_id = :r"),
            {"r": str(result["run_id"])},
        ).mappings().first()
    assert row["status"] == "failed"
    assert row["passed"] == 1
    assert row["failed"] == 1

    with get_connection() as conn:
        conn.execute(text("DELETE FROM platform_eval_case_results WHERE run_id = :r"), {"r": str(result["run_id"])})
        conn.execute(text("DELETE FROM platform_eval_runs WHERE run_id = :r"), {"r": str(result["run_id"])})
        conn.commit()


def test_assert_passes_before_shadow_mode_blocks_without_a_passing_run(test_tenant):
    unseen_feature_code = f"no-runs-{uuid.uuid4().hex[:8]}"
    with pytest.raises(GoldenDatasetRegressionRequired):
        assert_passes_before_shadow_mode(unseen_feature_code)


def test_assert_passes_before_shadow_mode_allows_after_a_passing_run(test_tenant, test_user):
    from app.platform.evals.repository import complete_eval_run, create_eval_run

    run_id = create_eval_run(
        feature_code=test_tenant["feature_code"], agent_version_under_test="v-test", triggered_by=test_user, total_cases=1
    )
    complete_eval_run(run_id=run_id, passed=1, failed=0, status="passed")

    assert_passes_before_shadow_mode(test_tenant["feature_code"])  # does not raise

    with get_connection() as conn:
        conn.execute(text("DELETE FROM platform_eval_runs WHERE run_id = :r"), {"r": str(run_id)})
        conn.commit()


# --- Fairness monitoring (E5) --------------------------------------------


def test_bucket_occupation_category():
    assert bucket_occupation_category("Retail Shopkeeper") == "retail_trade"
    assert bucket_occupation_category("Wholesale Trader — Dry Goods") == "wholesale_trade"
    assert bucket_occupation_category("Unemployed") == "unemployed_or_no_income"
    assert bucket_occupation_category("Astronaut") == "other"


def test_bucket_account_type():
    assert bucket_account_type("Wholesale Trader — Dry Goods") == "business"
    assert bucket_account_type("Retail Shopkeeper") == "business"
    assert bucket_account_type("Salaried Employee") == "individual"


def test_compute_fairness_snapshot_flags_a_deviating_segment(test_tenant):
    tenant_id = test_tenant["tenant_id"]
    period_start = datetime.now(UTC) - timedelta(days=1)
    period_end = datetime.now(UTC) + timedelta(days=1)

    case_ids = []
    with get_connection() as conn:
        # Baseline segment: 3 cases, none recommended STR.
        for i in range(3):
            case_id = uuid.uuid4()
            case_ids.append(case_id)
            conn.execute(
                text(
                    "INSERT INTO aml_cases (case_id, tenant_id, alert, status) VALUES (:c, :t, cast(:a as jsonb), 'open')"
                ),
                {"c": str(case_id), "t": tenant_id, "a": f'{{"source_alert_id": "x-{i}", "customer_id": "x", "account_ids": [], "transaction_refs": [], "rule_fired": "x"}}'},
            )
            conn.execute(
                text(
                    "INSERT INTO aml_evidence_bundles (case_id, kyc, transaction_timeline, agent_version) "
                    "VALUES (:c, cast(:kyc as jsonb), cast(:tt as jsonb), 'v1')"
                ),
                {"c": str(case_id), "kyc": '{"declared_occupation": "Salaried Employee"}', "tt": '[{"branch_code": "BR-001"}]'},
            )
            conn.execute(
                text(
                    "INSERT INTO aml_case_assessments (case_id, risk_score, recommendation, recommendation_confidence, draft_narrative, agent_version) "
                    "VALUES (:c, 10, 'clear', 0.9, 'narrative', 'v1')"
                ),
                {"c": str(case_id)},
            )

        # Deviating segment: 3 cases, all recommended STR (unemployed occupation bucket).
        for i in range(3):
            case_id = uuid.uuid4()
            case_ids.append(case_id)
            conn.execute(
                text(
                    "INSERT INTO aml_cases (case_id, tenant_id, alert, status) VALUES (:c, :t, cast(:a as jsonb), 'open')"
                ),
                {"c": str(case_id), "t": tenant_id, "a": f'{{"source_alert_id": "y-{i}", "customer_id": "y", "account_ids": [], "transaction_refs": [], "rule_fired": "y"}}'},
            )
            conn.execute(
                text(
                    "INSERT INTO aml_evidence_bundles (case_id, kyc, transaction_timeline, agent_version) "
                    "VALUES (:c, cast(:kyc as jsonb), cast(:tt as jsonb), 'v1')"
                ),
                {"c": str(case_id), "kyc": '{"declared_occupation": "Unemployed"}', "tt": '[{"branch_code": "BR-002"}]'},
            )
            conn.execute(
                text(
                    "INSERT INTO aml_case_assessments (case_id, risk_score, recommendation, recommendation_confidence, draft_narrative, agent_version) "
                    "VALUES (:c, 90, 'recommend_str', 0.9, 'narrative', 'v1')"
                ),
                {"c": str(case_id)},
            )
        conn.commit()

    try:
        snapshots = compute_fairness_snapshot(tenant_id, test_tenant["feature_code"], period_start, period_end)
        by_segment = {(s.segment_dimension, s.segment_value): s for s in snapshots}

        deviating = by_segment[("occupation_category", "unemployed_or_no_income")]
        assert deviating.str_recommendation_rate == pytest.approx(1.0)
        assert deviating.flagged is True

        baseline_segment = by_segment[("occupation_category", "salaried_employment")]
        assert baseline_segment.str_recommendation_rate == pytest.approx(0.0)
        assert baseline_segment.flagged is False
    finally:
        with get_connection() as conn:
            conn.execute(text("DELETE FROM platform_fairness_monitoring_snapshots WHERE tenant_id = :t"), {"t": tenant_id})
            for case_id in case_ids:
                conn.execute(text("DELETE FROM aml_case_assessments WHERE case_id = :c"), {"c": str(case_id)})
                conn.execute(text("DELETE FROM aml_evidence_bundles WHERE case_id = :c"), {"c": str(case_id)})
                conn.execute(text("DELETE FROM aml_cases WHERE case_id = :c"), {"c": str(case_id)})
            conn.commit()
