"""The agent chain's three writes (persistence.py) against the real
schema. Each is saved twice: the second save takes the ON CONFLICT
upsert path, which is SQL no other test executes — a stray column
there (typology_version in the assessment upsert, 2026-09-27) broke
every case's Case & Narrative step with all other tests green."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.persistence import save_case_assessment, save_typology_match
from app.features.aml_detection.schemas import AgentRecommendation, CaseAssessment, TypologyMatch


@pytest.fixture()
def case_id(test_tenant):
    cid = uuid.uuid4()
    with get_connection() as conn:
        conn.execute(
            text("INSERT INTO aml_cases (case_id, tenant_id, alert, status) VALUES (:c, :t, cast(:a as jsonb), 'open')"),
            {
                "c": str(cid),
                "t": test_tenant["tenant_id"],
                "a": '{"source_alert_id": "persistence-test", "customer_id": "x", "account_ids": [], "transaction_refs": [], "rule_fired": "x"}',
            },
        )
        conn.commit()
    yield cid
    with get_connection() as conn:
        conn.execute(text("DELETE FROM aml_case_assessments WHERE case_id = :c"), {"c": str(cid)})
        conn.execute(text("DELETE FROM aml_typology_matches WHERE case_id = :c"), {"c": str(cid)})
        conn.execute(text("DELETE FROM aml_cases WHERE case_id = :c"), {"c": str(cid)})
        conn.commit()


def _row(table: str, case_id: uuid.UUID) -> dict:
    with get_connection() as conn:
        return dict(conn.execute(text(f"SELECT * FROM {table} WHERE case_id = :c"), {"c": str(case_id)}).mappings().one())


def test_typology_match_saves_and_upserts_with_its_version(case_id):
    match = TypologyMatch(
        case_id=case_id,
        typology_code="structuring_subthreshold",
        typology_label="Structuring",
        confidence=0.8,
        matched_indicators=[],
        plain_language_rationale="first",
        typology_version=1,
        agent_version="v1",
    )
    save_typology_match(match)
    save_typology_match(match.model_copy(update={"plain_language_rationale": "second", "typology_version": 2}))

    row = _row("aml_typology_matches", case_id)
    assert row["plain_language_rationale"] == "second"
    assert row["typology_version"] == 2


def test_case_assessment_saves_and_upserts(case_id):
    assessment = CaseAssessment(
        case_id=case_id,
        risk_score=70,
        recommendation=AgentRecommendation.ESCALATE,
        recommendation_confidence=0.7,
        draft_narrative="first",
        agent_version="v1",
    )
    save_case_assessment(assessment)
    save_case_assessment(assessment.model_copy(update={"draft_narrative": "second", "risk_score": 85}))

    row = _row("aml_case_assessments", case_id)
    assert row["draft_narrative"] == "second"
    assert row["risk_score"] == 85
