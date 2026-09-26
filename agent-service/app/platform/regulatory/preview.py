"""Draft-inclusive retrieval for the Document view's "Test retrieval"
box (specs/suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md).

Deliberately a separate module from repository.retrieve_regulatory_context():
this is the only code path that can rank a *draft* document's chunks,
and nothing under app/features/ may import it
(tests/test_regulatory_preview_isolation.py) — so a draft can never
reach an agent prompt by construction, not convention."""

from __future__ import annotations

from sqlalchemy import text

from app.db import get_connection
from app.platform.regulatory.embeddings import get_embedding
from app.platform.regulatory.repository import retrieval_sql


def preview_regulatory_retrieval(
    feature_code: str, query: str, top_k: int = 5, include_draft_document_id: str | None = None
) -> list[dict]:
    query_embedding = get_embedding(query)
    with get_connection() as conn:
        rows = conn.execute(
            text(retrieval_sql(include_draft=include_draft_document_id is not None)),
            {
                "query_embedding": str(query_embedding),
                "feature_code": feature_code,
                "top_k": top_k,
                "typology_codes": None,
                "apply_typology_filter": False,
                "draft_document_id": include_draft_document_id,
            },
        ).mappings().all()
    return [
        {
            "chunk_id": str(r["chunk_id"]),
            "document_id": str(r["document_id"]),
            "document_title": r["document_title"],
            "document_status": r["status"],
            "section_reference": r["section_reference"],
            "text": r["text"],
            "score": max(0.0, min(1.0, float(r["relevance_score"]))),
        }
        for r in rows
    ]
