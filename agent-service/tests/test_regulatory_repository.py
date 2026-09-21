"""specs/platform/10-regulatory-knowledge-base-spec.md — verifies
retrieve_regulatory_context() against the real Phase 1 hand-seeded
corpus (scripts/seed_regulatory_corpus.py). Uses real OpenAI embedding
calls, consistent with this project's existing e2e tests (e.g.
aml-ingest.e2e-spec.ts) exercising real LLM calls rather than mocking
the model boundary."""

from __future__ import annotations

from app.platform.regulatory.repository import retrieve_regulatory_context


def test_structuring_query_returns_relevant_citations():
    citations = retrieve_regulatory_context(
        feature_code="aml_detection",
        query="multiple cash deposits just below the reporting threshold across several branches",
        top_k=5,
    )

    assert citations, "expected the seeded corpus to return at least one citation for a structuring query"
    assert any("Structuring" in c.section_reference for c in citations)
    for c in citations:
        assert 0.0 <= c.relevance_score <= 1.0


def test_high_velocity_query_returns_relevant_citations():
    citations = retrieve_regulatory_context(
        feature_code="aml_detection",
        query="sudden unexplained increase in cash transaction volume inconsistent with declared occupation",
        top_k=5,
    )

    assert citations
    assert any("High-velocity" in c.section_reference for c in citations)


def test_unseeded_feature_returns_empty_list():
    citations = retrieve_regulatory_context(
        feature_code="no_such_feature",
        query="anything",
        top_k=5,
    )

    assert citations == []
