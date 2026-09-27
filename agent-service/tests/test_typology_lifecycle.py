"""Typology lifecycle (v2) — migration 014's data-layer guarantees, the
agent's promoted-only catalog read, the candidate catalog, and the
regression workflow's activities.
specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md

The console's writes are app-api's (spec 09); the SQL helpers here do
what its promote transaction does, so these tests pin the database
backstop independently of either service's code."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine
from app.features.aml_detection import typology_regression
from app.features.aml_detection.typology_candidate import CandidateNotADraft, candidate_catalog
from app.features.aml_detection.typology_config_repository import get_active_typologies
from app.platform.evals.repository import seed_golden_dataset_case
from app.platform.evals.types import GoldenDatasetCase

FEATURE = "aml_detection"


@pytest.fixture()
def typology(test_user):
    """A throwaway typology, live at v1 — seeded under the maintenance
    override exactly as seed-typology-configs.ts seeds the baseline."""
    code = f"test_typology_{uuid.uuid4().hex[:8]}"
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL polychoron.typology_maintenance = 'on'"))
        conn.execute(text("INSERT INTO aml_typology_configs (typology_code, created_by) VALUES (:c, :u)"), {"c": code, "u": test_user})
        conn.execute(
            text(
                "INSERT INTO aml_typology_config_versions "
                "(typology_code, version, typology_label, rule_logic_description, active, status, changed_by, change_reason) "
                "VALUES (:c, 1, 'Test typology', 'Original rule text', true, 'promoted', :u, 'seed')"
            ),
            {"c": code, "u": test_user},
        )
        conn.execute(text("UPDATE aml_typology_configs SET production_version = 1 WHERE typology_code = :c"), {"c": code})
    yield code
    _purge([code], test_user)


def _purge(codes: list[str], user: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL polychoron.typology_maintenance = 'on'"))
        conn.execute(text("DELETE FROM aml_typology_promotions WHERE typology_code = ANY(:c)"), {"c": codes})
        conn.execute(text("UPDATE aml_typology_configs SET production_version = NULL WHERE typology_code = ANY(:c)"), {"c": codes})
        conn.execute(text("DELETE FROM aml_typology_config_versions WHERE typology_code = ANY(:c)"), {"c": codes})
        conn.execute(text("DELETE FROM aml_typology_configs WHERE typology_code = ANY(:c)"), {"c": codes})
        runs = [r[0] for r in conn.execute(text("SELECT run_id FROM platform_eval_runs WHERE triggered_by = :u"), {"u": user})]
        if runs:
            conn.execute(text("DELETE FROM platform_eval_case_results WHERE run_id = ANY(:r)"), {"r": runs})
            conn.execute(text("DELETE FROM platform_eval_runs WHERE run_id = ANY(:r)"), {"r": runs})


def _open_draft(code: str, user: str, *, description: str = "Edited rule text", active: bool = True, version: int = 2) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO aml_typology_config_versions "
                "(typology_code, version, typology_label, rule_logic_description, active, status, changed_by, change_reason) "
                "VALUES (:c, :v, 'Test typology', :d, :a, 'draft', :u, 'tighten the rule')"
            ),
            {"c": code, "v": version, "d": description, "a": active, "u": user},
        )


def _eval_run(code: str, version: int, user: str, *, status: str = "passed", key: str | None = None) -> str:
    """A finished regression run — the same fixed-result approach the KB
    tests use for embeddings, so no live LLM is needed."""
    with engine.begin() as conn:
        if key is None:
            key = conn.execute(
                text(
                    "SELECT aml_typology_candidate_key(typology_code, version, content_hash) "
                    "FROM aml_typology_config_versions WHERE typology_code = :c AND version = :v"
                ),
                {"c": code, "v": version},
            ).scalar_one()
        return str(
            conn.execute(
                text(
                    "INSERT INTO platform_eval_runs (feature_code, agent_version_under_test, triggered_by, total_cases, "
                    "passed, status, completed_at) VALUES (:f, :k, :u, 1, 1, :s, now()) RETURNING run_id"
                ),
                {"f": FEATURE, "k": key, "u": user, "s": status},
            ).scalar_one()
        )


def _promote(code: str, version: int, user: str, run_id: str | None) -> None:
    """What app-api's promote does, in one transaction."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO aml_typology_promotions (typology_code, promoted_version, eval_run_id, promoted_by, reason) "
                "VALUES (:c, :v, :r, :u, 'regression passed')"
            ),
            {"c": code, "v": version, "r": run_id, "u": user},
        )
        conn.execute(
            text("UPDATE aml_typology_config_versions SET status = 'superseded' WHERE typology_code = :c AND status = 'promoted'"),
            {"c": code},
        )
        conn.execute(
            text("UPDATE aml_typology_config_versions SET status = 'promoted' WHERE typology_code = :c AND version = :v"),
            {"c": code, "v": version},
        )
        conn.execute(text("UPDATE aml_typology_configs SET production_version = :v WHERE typology_code = :c"), {"c": code, "v": version})


def _live(code: str) -> dict | None:
    return next((t for t in get_active_typologies() if t["typology_code"] == code), None)


def _statuses(code: str) -> dict[int, str]:
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT version, status FROM aml_typology_config_versions WHERE typology_code = :c"), {"c": code}
        ).all()
    return {v: s for v, s in rows}


# ── The agent reads only the promoted version ───────────────────────


def test_a_draft_edit_never_reaches_the_agent_catalog(typology, test_user):
    before = _live(typology)
    _open_draft(typology, test_user, description="Something the agent must not see yet")
    after = _live(typology)
    assert before == after
    assert after["rule_logic_description"] == "Original rule text"
    assert after["version"] == 1


def test_a_never_promoted_typology_is_not_in_the_catalog(test_user):
    code = f"test_typology_{uuid.uuid4().hex[:8]}"
    try:
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO aml_typology_configs (typology_code, created_by) VALUES (:c, :u)"), {"c": code, "u": test_user})
        _open_draft(code, test_user, version=1)
        assert _live(code) is None
    finally:
        _purge([code], test_user)


def test_promotion_with_a_passing_run_goes_live_and_supersedes(typology, test_user):
    _open_draft(typology, test_user)
    _promote(typology, 2, test_user, _eval_run(typology, 2, test_user))

    assert _live(typology)["rule_logic_description"] == "Edited rule text"
    assert _live(typology)["version"] == 2
    assert _statuses(typology) == {1: "superseded", 2: "promoted"}


def test_retiring_removes_the_typology_but_keeps_history(typology, test_user):
    _open_draft(typology, test_user, description="Original rule text", active=False)
    _promote(typology, 2, test_user, _eval_run(typology, 2, test_user))

    assert _live(typology) is None
    assert _statuses(typology) == {1: "superseded", 2: "promoted"}


# ── Migration 014 backstop ───────────────────────────────────────────


def test_db_rejects_promotion_without_a_matching_passing_run(typology, test_user):
    _open_draft(typology, test_user)
    # No run at all: the guard trigger refuses before the NOT-NULL-unless-
    # pre_v2 CHECK is even reached.
    with pytest.raises(DBAPIError, match="needs a passing golden-dataset regression"):
        _promote(typology, 2, test_user, None)
    with pytest.raises(DBAPIError, match="needs a passing golden-dataset regression"):
        _promote(typology, 2, test_user, _eval_run(typology, 2, test_user, status="failed"))

    stale = _eval_run(typology, 2, test_user)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE aml_typology_config_versions SET rule_logic_description = 'edited after the run' WHERE typology_code = :c AND version = 2"),
            {"c": typology},
        )
    with pytest.raises(DBAPIError, match="needs a passing golden-dataset regression"):
        _promote(typology, 2, test_user, stale)
    assert _live(typology)["version"] == 1


def test_db_blocks_status_flips_and_pointer_moves_that_skip_promotion(typology, test_user):
    _open_draft(typology, test_user)
    with pytest.raises(DBAPIError, match="no promotion record"), engine.begin() as conn:
        conn.execute(text("UPDATE aml_typology_config_versions SET status = 'superseded' WHERE typology_code = :c AND version = 1"), {"c": typology})
        conn.execute(text("UPDATE aml_typology_config_versions SET status = 'promoted' WHERE typology_code = :c AND version = 2"), {"c": typology})
    with pytest.raises(DBAPIError, match="must point at the promoted version"), engine.begin() as conn:
        conn.execute(text("UPDATE aml_typology_configs SET production_version = 2 WHERE typology_code = :c"), {"c": typology})
    with pytest.raises(DBAPIError, match="starts as a draft"), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO aml_typology_config_versions "
                "(typology_code, version, typology_label, rule_logic_description, active, status, changed_by, change_reason) "
                "VALUES (:c, 3, 'x', 'y', true, 'promoted', :u, 'z')"
            ),
            {"c": typology, "u": test_user},
        )


def test_db_rejects_edits_and_deletes_of_published_versions(typology, test_user):
    with pytest.raises(DBAPIError, match="immutable once promoted"), engine.begin() as conn:
        conn.execute(
            text("UPDATE aml_typology_config_versions SET rule_logic_description = 'tampered' WHERE typology_code = :c"),
            {"c": typology},
        )
    with pytest.raises(DBAPIError, match="never deleted"), engine.begin() as conn:
        conn.execute(text("DELETE FROM aml_typology_config_versions WHERE typology_code = :c"), {"c": typology})
    with pytest.raises(DBAPIError, match="retired, never deleted"), engine.begin() as conn:
        conn.execute(text("DELETE FROM aml_typology_configs WHERE typology_code = :c"), {"c": typology})


def test_db_keeps_one_draft_and_blocks_edit_and_promote_in_one_update(typology, test_user):
    _open_draft(typology, test_user)
    with pytest.raises(DBAPIError, match="one_draft"):
        _open_draft(typology, test_user, version=3)
    with pytest.raises(DBAPIError, match="immutable once draft"), engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE aml_typology_config_versions SET rule_logic_description = 'sneaky', status = 'discarded', "
                "discarded_by = :u, discarded_at = now(), discard_reason = 'x' WHERE typology_code = :c AND version = 2"
            ),
            {"c": typology, "u": test_user},
        )


def test_discard_needs_a_reason_and_frees_the_draft_slot(typology, test_user):
    _open_draft(typology, test_user)
    with pytest.raises(DBAPIError, match="discard_check"), engine.begin() as conn:
        conn.execute(text("UPDATE aml_typology_config_versions SET status = 'discarded' WHERE typology_code = :c AND version = 2"), {"c": typology})
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE aml_typology_config_versions SET status = 'discarded', discarded_by = :u, discarded_at = now(), "
                "discard_reason = 'not needed' WHERE typology_code = :c AND version = 2"
            ),
            {"c": typology, "u": test_user},
        )
    _open_draft(typology, test_user, version=3)
    assert _statuses(typology) == {1: "promoted", 2: "discarded", 3: "draft"}


def test_promotions_are_append_only_and_need_a_reason(typology, test_user):
    _open_draft(typology, test_user)
    run_id = _eval_run(typology, 2, test_user)
    with pytest.raises(DBAPIError, match="reason_check"), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO aml_typology_promotions (typology_code, promoted_version, eval_run_id, promoted_by, reason) "
                "VALUES (:c, 2, :r, :u, '  ')"
            ),
            {"c": typology, "r": run_id, "u": test_user},
        )
    _promote(typology, 2, test_user, run_id)
    with pytest.raises(DBAPIError, match="append-only"), engine.begin() as conn:
        conn.execute(text("UPDATE aml_typology_promotions SET reason = 'rewritten' WHERE typology_code = :c"), {"c": typology})


# ── Candidate catalog ────────────────────────────────────────────────


def test_candidate_catalog_substitutes_the_draft_and_keys_its_content(typology, test_user):
    _open_draft(typology, test_user)
    catalog, key = candidate_catalog(typology, 2)
    entry = next(t for t in catalog if t["typology_code"] == typology)
    assert entry["rule_logic_description"] == "Edited rule text"
    assert entry["version"] == 2
    assert key.startswith(f"typology:{typology}:v2:")
    # Everything else in the candidate is the promoted catalog, unchanged.
    others = [t for t in catalog if t["typology_code"] != typology]
    assert others == [t for t in get_active_typologies() if t["typology_code"] != typology]


def test_candidate_catalog_drops_a_retiring_typology(typology, test_user):
    _open_draft(typology, test_user, active=False)
    catalog, _ = candidate_catalog(typology, 2)
    assert all(t["typology_code"] != typology for t in catalog)


def test_candidate_catalog_refuses_anything_but_an_open_draft(typology):
    with pytest.raises(CandidateNotADraft):
        candidate_catalog(typology, 1)


# ── Regression workflow activities ───────────────────────────────────


@pytest.fixture()
def one_golden_case(test_tenant, test_user):
    case = GoldenDatasetCase(
        feature_code=FEATURE,
        scenario_name=f"test-typology-regression-{uuid.uuid4().hex[:8]}",
        input_evidence_fixture={},
        expected_typology=None,
        tags=["test-typology-regression"],
        created_by=test_user,
    )
    seed_golden_dataset_case(case)
    yield case
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM platform_eval_case_results WHERE golden_case_id = :c"), {"c": str(case.case_id)})
        conn.execute(text("DELETE FROM platform_golden_dataset_cases WHERE case_id = :c"), {"c": str(case.case_id)})


def test_regression_activities_record_a_run_the_promotion_guard_accepts(
    typology, test_user, test_tenant, one_golden_case, monkeypatch
):
    monkeypatch.setattr(typology_regression, "list_golden_dataset_cases", lambda feature_code, **_: [one_golden_case])
    seen_catalogs = []

    def fake_run_one_case(case, tenant_id, *, catalog_override=None):
        seen_catalogs.append(catalog_override)
        return True, None, None, None, None

    monkeypatch.setattr(typology_regression, "run_one_case", fake_run_one_case)
    _open_draft(typology, test_user)
    run_id = str(uuid.uuid4())

    prepared = typology_regression.prepare_typology_regression_activity(
        {"run_id": run_id, "typology_code": typology, "version": 2, "triggered_by": test_user}
    )
    assert prepared["case_ids"] == [str(one_golden_case.case_id)]
    typology_regression.run_typology_regression_case_activity(
        {"run_id": run_id, "tenant_id": test_tenant["tenant_id"], "case_id": prepared["case_ids"][0], "catalog": prepared["catalog"]}
    )
    result = typology_regression.complete_typology_regression_activity(run_id)

    assert result == {"status": "passed", "passed": 1, "failed": 0, "total": 1}
    assert any(t["rule_logic_description"] == "Edited rule text" for t in seen_catalogs[0])
    _promote(typology, 2, test_user, run_id)
    assert _live(typology)["version"] == 2


def test_regression_counts_a_missing_or_erroring_case_as_failed(typology, test_user, test_tenant, one_golden_case, monkeypatch):
    monkeypatch.setattr(typology_regression, "list_golden_dataset_cases", lambda feature_code, **_: [one_golden_case])

    def boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(typology_regression, "run_one_case", boom)
    _open_draft(typology, test_user)
    run_id = str(uuid.uuid4())
    prepared = typology_regression.prepare_typology_regression_activity(
        {"run_id": run_id, "typology_code": typology, "version": 2, "triggered_by": test_user}
    )
    assert typology_regression.run_typology_regression_case_activity(
        {"run_id": run_id, "tenant_id": test_tenant["tenant_id"], "case_id": prepared["case_ids"][0], "catalog": prepared["catalog"]}
    ) is False
    assert typology_regression.complete_typology_regression_activity(run_id)["status"] == "failed"

    # A run whose workflow died before completing is marked failed, not left running.
    other = str(uuid.uuid4())
    typology_regression.prepare_typology_regression_activity(
        {"run_id": other, "typology_code": typology, "version": 2, "triggered_by": test_user}
    )
    typology_regression.fail_typology_regression_activity(other)
    with engine.begin() as conn:
        assert conn.execute(text("SELECT status FROM platform_eval_runs WHERE run_id = :r"), {"r": other}).scalar_one() == "failed"


# ── Traceability ─────────────────────────────────────────────────────


def test_a_match_records_the_promoted_version_that_was_in_the_prompt(typology, test_user, test_tenant, monkeypatch):
    from app.features.aml_detection.nodes import pattern_matching as pattern_matching_module
    from app.features.aml_detection.nodes.pattern_matching import PatternMatchingNode
    from app.platform import agent_node as agent_node_module
    from tests.test_guardrails import _RecordingFakeClient, _structuring_evidence

    _open_draft(typology, test_user)
    _promote(typology, 2, test_user, _eval_run(typology, 2, test_user))

    fake_client = _RecordingFakeClient(
        {
            "typology_code": typology,
            "typology_label": "Test typology",
            "confidence": 0.8,
            "matched_indicators": [],
            "plain_language_rationale": "Matches the test rule.",
            "cited_chunk_ids": [],
        }
    )
    monkeypatch.setattr(agent_node_module, "get_inference_client", lambda *a, **k: fake_client)
    monkeypatch.setattr(pattern_matching_module, "retrieve_regulatory_context", lambda **kwargs: [])

    case_id = uuid.uuid4()
    result = PatternMatchingNode().run(_structuring_evidence(case_id, inject_narration=False), test_tenant["tenant_id"], case_id)

    assert result.typology_version == 2
    assert "Edited rule text" in fake_client.last_prompt
