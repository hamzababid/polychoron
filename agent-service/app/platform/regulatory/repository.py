"""specs/platform/10-regulatory-knowledge-base-spec.md — the retrieval
contract every agent node calls, plus the human-gated ingestion
helpers used by seed scripts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text

from app.db import get_connection
from app.platform.regulatory.embeddings import get_embedding
from app.platform.regulatory.types import RegulatoryCitation, RegulatorySourceType


def retrieve_regulatory_context(feature_code: str, query: str, top_k: int = 5) -> list[RegulatoryCitation]:
    """Vector-similarity search over this feature's ingested corpus.
    Never called by a node that makes a suspicion/filing decision —
    there is no such node; that decision stays human (constitution
    rule 1). Returns [] if the corpus is empty rather than erroring —
    callers must proceed as before when nothing comes back (see
    pattern_matching.py's additive wiring)."""
    query_embedding = get_embedding(query)

    with get_connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    c.chunk_id, c.section_reference, d.title AS document_title,
                    1 - (c.embedding <=> cast(:query_embedding as vector)) AS relevance_score
                FROM regulatory_chunks c
                JOIN regulatory_documents d ON d.document_id = c.document_id
                WHERE d.feature_code = :feature_code AND d.superseded_by IS NULL
                ORDER BY c.embedding <=> cast(:query_embedding as vector)
                LIMIT :top_k
                """
            ),
            {"query_embedding": str(query_embedding), "feature_code": feature_code, "top_k": top_k},
        ).mappings().all()

    return [
        RegulatoryCitation(
            chunk_id=row["chunk_id"],
            document_title=row["document_title"],
            section_reference=row["section_reference"],
            relevance_score=max(0.0, min(1.0, float(row["relevance_score"]))),
        )
        for row in rows
    ]


def ingest_document(
    *,
    feature_code: str,
    title: str,
    source_type: RegulatorySourceType,
    issuing_authority: str,
    version_label: str,
    ingested_by: str,
    source_url: str | None = None,
) -> UUID:
    """Human-gated — ingested_by is required, logged permanently, same
    accountability trail as a typology promotion (non-negotiable #2)."""
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO regulatory_documents
                    (feature_code, title, source_type, issuing_authority, version_label, source_url, ingested_at, ingested_by)
                VALUES (:feature_code, :title, :source_type, :issuing_authority, :version_label, :source_url, :ingested_at, :ingested_by)
                RETURNING document_id
                """
            ),
            {
                "feature_code": feature_code,
                "title": title,
                "source_type": source_type.value,
                "issuing_authority": issuing_authority,
                "version_label": version_label,
                "source_url": source_url,
                "ingested_at": datetime.now(UTC),
                "ingested_by": ingested_by,
            },
        )
        document_id = result.scalar_one()
        conn.commit()
        return document_id


def ingest_chunk(*, document_id: UUID, section_reference: str, chunk_text: str) -> UUID:
    embedding = get_embedding(chunk_text)
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO regulatory_chunks (document_id, section_reference, text, embedding)
                VALUES (:document_id, :section_reference, :text, cast(:embedding as vector))
                RETURNING chunk_id
                """
            ),
            {
                "document_id": str(document_id),
                "section_reference": section_reference,
                "text": chunk_text,
                "embedding": json.dumps(embedding),
            },
        )
        chunk_id = result.scalar_one()
        conn.commit()
        return chunk_id


def supersede_document(*, old_document_id: UUID, new_document_id: UUID) -> None:
    """Points the old document forward to its replacement — retained,
    never deleted (constitution rule 8 / spec non-negotiable #3): a case
    decided under an older version must stay explainable against the
    text that was actually in force at the time."""
    with get_connection() as conn:
        conn.execute(
            text("UPDATE regulatory_documents SET superseded_by = :new_id WHERE document_id = :old_id"),
            {"new_id": str(new_document_id), "old_id": str(old_document_id)},
        )
        conn.commit()


def reembed_chunk(*, chunk_id: UUID, chunk_text: str) -> None:
    """Re-runs get_embedding() for an existing chunk's already-stored
    text and updates its embedding in place — e.g. after an embedding-
    model change. Never re-derives the text itself; that would be a
    content edit, not a re-embed."""
    embedding = get_embedding(chunk_text)
    with get_connection() as conn:
        conn.execute(
            text("UPDATE regulatory_chunks SET embedding = cast(:embedding as vector) WHERE chunk_id = :chunk_id"),
            {"embedding": json.dumps(embedding), "chunk_id": str(chunk_id)},
        )
        conn.commit()


def list_documents(feature_code: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT d.document_id, d.title, d.source_type, d.issuing_authority,
                       d.version_label, d.effective_date, d.superseded_by, d.source_url,
                       d.ingested_at, d.ingested_by,
                       count(c.chunk_id)::int AS chunk_count
                FROM regulatory_documents d
                LEFT JOIN regulatory_chunks c ON c.document_id = d.document_id
                WHERE d.feature_code = :feature_code
                GROUP BY d.document_id
                ORDER BY d.ingested_at DESC
                """
            ),
            {"feature_code": feature_code},
        ).mappings().all()
    return [dict(row) for row in rows]


def list_chunks(document_id: UUID) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            text(
                "SELECT chunk_id, document_id, section_reference, text FROM regulatory_chunks "
                "WHERE document_id = :document_id ORDER BY section_reference"
            ),
            {"document_id": str(document_id)},
        ).mappings().all()
    return [dict(row) for row in rows]
