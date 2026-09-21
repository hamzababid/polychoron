"""Writes to aml_evidence_bundles / aml_typology_matches /
aml_case_assessments — the three AML tables agent-service owns writes
to per specs/platform/09-backend-service-boundary-spec.md. app-api
reads these freely but never writes them."""

from __future__ import annotations

import json

from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.schemas import CaseAssessment, EvidenceBundle, TypologyMatch


def save_evidence_bundle(bundle: EvidenceBundle) -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO aml_evidence_bundles (
                    case_id, kyc, transaction_timeline, linked_entities,
                    prior_cases, screening_results, assembled_at, agent_version
                ) VALUES (
                    :case_id, cast(:kyc as jsonb), cast(:transaction_timeline as jsonb),
                    cast(:linked_entities as jsonb), cast(:prior_cases as jsonb),
                    cast(:screening_results as jsonb), :assembled_at, :agent_version
                )
                ON CONFLICT (case_id) DO UPDATE SET
                    kyc = EXCLUDED.kyc,
                    transaction_timeline = EXCLUDED.transaction_timeline,
                    linked_entities = EXCLUDED.linked_entities,
                    prior_cases = EXCLUDED.prior_cases,
                    screening_results = EXCLUDED.screening_results,
                    assembled_at = EXCLUDED.assembled_at,
                    agent_version = EXCLUDED.agent_version
                """
            ),
            {
                "case_id": str(bundle.case_id),
                "kyc": bundle.kyc.model_dump_json(),
                "transaction_timeline": json.dumps([t.model_dump(mode="json") for t in bundle.transaction_timeline]),
                "linked_entities": json.dumps([e.model_dump(mode="json") for e in bundle.linked_entities]),
                "prior_cases": json.dumps([p.model_dump(mode="json") for p in bundle.prior_cases]),
                "screening_results": json.dumps([s.model_dump(mode="json") for s in bundle.screening_results]),
                "assembled_at": bundle.assembled_at,
                "agent_version": bundle.agent_version,
            },
        )
        conn.commit()


def save_typology_match(match: TypologyMatch) -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO aml_typology_matches (
                    case_id, typology_code, typology_label, confidence,
                    matched_indicators, plain_language_rationale, regulatory_citations,
                    matched_at, agent_version
                ) VALUES (
                    :case_id, :typology_code, :typology_label, :confidence,
                    cast(:matched_indicators as jsonb), :plain_language_rationale,
                    cast(:regulatory_citations as jsonb), :matched_at, :agent_version
                )
                ON CONFLICT (case_id) DO UPDATE SET
                    typology_code = EXCLUDED.typology_code,
                    typology_label = EXCLUDED.typology_label,
                    confidence = EXCLUDED.confidence,
                    matched_indicators = EXCLUDED.matched_indicators,
                    plain_language_rationale = EXCLUDED.plain_language_rationale,
                    regulatory_citations = EXCLUDED.regulatory_citations,
                    matched_at = EXCLUDED.matched_at,
                    agent_version = EXCLUDED.agent_version
                """
            ),
            {
                "case_id": str(match.case_id),
                "typology_code": match.typology_code,
                "typology_label": match.typology_label,
                "confidence": match.confidence,
                "matched_indicators": json.dumps([i.model_dump(mode="json") for i in match.matched_indicators]),
                "plain_language_rationale": match.plain_language_rationale,
                "regulatory_citations": json.dumps([c.model_dump(mode="json") for c in match.regulatory_citations]),
                "matched_at": match.matched_at,
                "agent_version": match.agent_version,
            },
        )
        conn.commit()


def save_case_assessment(assessment: CaseAssessment) -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO aml_case_assessments (
                    case_id, risk_score, recommendation, recommendation_confidence,
                    draft_narrative, str_fields_draft, regulatory_context_used,
                    assessed_at, agent_version
                ) VALUES (
                    :case_id, :risk_score, :recommendation, :recommendation_confidence,
                    :draft_narrative, cast(:str_fields_draft as jsonb),
                    cast(:regulatory_context_used as jsonb), :assessed_at, :agent_version
                )
                ON CONFLICT (case_id) DO UPDATE SET
                    risk_score = EXCLUDED.risk_score,
                    recommendation = EXCLUDED.recommendation,
                    recommendation_confidence = EXCLUDED.recommendation_confidence,
                    draft_narrative = EXCLUDED.draft_narrative,
                    str_fields_draft = EXCLUDED.str_fields_draft,
                    regulatory_context_used = EXCLUDED.regulatory_context_used,
                    assessed_at = EXCLUDED.assessed_at,
                    agent_version = EXCLUDED.agent_version
                """
            ),
            {
                "case_id": str(assessment.case_id),
                "risk_score": assessment.risk_score,
                "recommendation": assessment.recommendation.value,
                "recommendation_confidence": assessment.recommendation_confidence,
                "draft_narrative": assessment.draft_narrative,
                "str_fields_draft": (
                    assessment.str_fields_draft.model_dump_json() if assessment.str_fields_draft else None
                ),
                "regulatory_context_used": json.dumps(
                    [c.model_dump(mode="json") for c in assessment.regulatory_context_used]
                ),
                "assessed_at": assessment.assessed_at,
                "agent_version": assessment.agent_version,
            },
        )
        conn.commit()
