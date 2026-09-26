"""specs/platform/10-regulatory-knowledge-base-spec.md — the retrieval
contract every agent node calls, plus the human-gated ingestion
helpers used by seed scripts."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text

from app.db import engine, get_connection
from app.platform.regulatory.embeddings import get_embedding
from app.platform.regulatory.types import RegulatoryCitation, RegulatorySourceType


def retrieve_regulatory_context(
    feature_code: str, query: str, top_k: int = 5, typology_codes: list[str] | None = None
) -> list[RegulatoryCitation]:
    """Vector-similarity search over this feature's ingested corpus.
    Never called by a node that makes a suspicion/filing decision —
    there is no such node; that decision stays human (constitution
    rule 1). Returns [] if the corpus is empty rather than erroring —
    callers must proceed as before when nothing comes back (see
    pattern_matching.py's additive wiring).

    Only `current`, retrieval-enabled documents are searched — drafts,
    superseded and withdrawn versions never reach an agent. When
    `typology_codes` is given (the typologies the calling agent is
    actually evaluating), a document restricted to other typologies is
    excluded. Ranking is similarity × the document's retrieval_priority;
    the reported relevance_score stays the raw similarity."""
    query_embedding = get_embedding(query)

    with get_connection() as conn:
        rows = conn.execute(
            text(retrieval_sql(include_draft=False)),
            {
                "query_embedding": str(query_embedding),
                "feature_code": feature_code,
                "top_k": top_k,
                "typology_codes": typology_codes,
                "apply_typology_filter": typology_codes is not None,
                "draft_document_id": None,
            },
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


def retrieval_sql(*, include_draft: bool) -> str:
    """Shared ranking SQL. `include_draft=True` is used only by
    preview.py's Test-retrieval (never importable from app/features —
    enforced by tests/test_regulatory_preview_isolation.py)."""
    draft_clause = "OR d.document_id = cast(:draft_document_id as uuid)" if include_draft else ""
    return f"""
        SELECT
            c.chunk_id, c.document_id, c.section_reference, c.text, d.title AS document_title, d.status,
            1 - (c.embedding <=> cast(:query_embedding as vector)) AS relevance_score
        FROM regulatory_chunks c
        JOIN regulatory_documents d ON d.document_id = c.document_id
        WHERE d.feature_code = :feature_code
          AND c.embedding IS NOT NULL
          AND (
                (d.status = 'current' AND d.retrieval_enabled
                 AND (NOT :apply_typology_filter
                      OR cardinality(d.related_typology_codes) = 0
                      OR d.related_typology_codes && cast(:typology_codes as text[])))
                {draft_clause}
              )
        ORDER BY (1 - (c.embedding <=> cast(:query_embedding as vector))) * d.retrieval_priority DESC
        LIMIT :top_k
    """


def ingest_document(
    *,
    feature_code: str,
    title: str,
    source_type: RegulatorySourceType,
    issuing_authority: str,
    version_label: str,
    ingested_by: str,
    source_url: str | None = None,
    supersedes_document_id: UUID | None = None,
    source_method: str = "seed",
) -> UUID:
    """Human-gated — ingested_by is required, logged permanently, same
    accountability trail as a typology promotion (non-negotiable #2).

    Creates a **draft** (migration 013: chunks can only be added to a
    draft). Call publish_document() once its chunks are ingested. With
    `supersedes_document_id`, the draft joins that document's family as
    its next version, and publishing it supersedes the old one."""
    with get_connection() as conn:
        family_id, version_number = None, 1
        if supersedes_document_id is not None:
            family = conn.execute(
                text(
                    """
                    SELECT d.document_family_id,
                           (SELECT max(version_number) FROM regulatory_documents f
                            WHERE f.document_family_id = d.document_family_id) AS max_version
                    FROM regulatory_documents d WHERE d.document_id = :id
                    """
                ),
                {"id": str(supersedes_document_id)},
            ).mappings().one()
            family_id, version_number = family["document_family_id"], family["max_version"] + 1

        result = conn.execute(
            text(
                """
                INSERT INTO regulatory_documents
                    (feature_code, title, source_type, issuing_authority, version_label, source_url, ingested_at,
                     ingested_by, status, document_family_id, version_number, source_method)
                VALUES (:feature_code, :title, :source_type, :issuing_authority, :version_label, :source_url,
                        :ingested_at, :ingested_by, 'draft', :family_id, :version_number, :source_method)
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
                "family_id": str(family_id) if family_id else None,
                "version_number": version_number,
                "source_method": source_method,
            },
        )
        document_id = result.scalar_one()
        conn.commit()
        return document_id


def ingest_chunk(*, document_id: UUID, section_reference: str, chunk_text: str) -> UUID:
    """Appends an embedded chunk to a draft, in call order (ordinal)."""
    embedding = get_embedding(chunk_text)
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO regulatory_chunks (document_id, section_reference, text, embedding, ordinal, char_count)
                VALUES (
                    :document_id, :section_reference, :text, cast(:embedding as vector),
                    (SELECT coalesce(max(ordinal), 0) + 1 FROM regulatory_chunks WHERE document_id = :document_id),
                    length(:text)
                )
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


def publish_document(*, document_id: UUID, published_by: str) -> None:
    """Draft -> current, superseding the family's previous current
    version in the same transaction (retained, never deleted —
    constitution rule 8 / non-negotiable #3). Used by the seed script and
    the legacy one-shot ingestion workflow; the management screen's
    publish goes through lifecycle.publish_draft(), which adds the
    screen's validation on top of the same transition."""
    with engine.begin() as conn:
        _publish(conn, document_id=document_id, published_by=published_by)


def _publish(conn, *, document_id: UUID, published_by: str) -> UUID | None:
    family_id = conn.execute(
        text("SELECT document_family_id FROM regulatory_documents WHERE document_id = :id FOR UPDATE"),
        {"id": str(document_id)},
    ).scalar_one()
    superseded = conn.execute(
        text(
            """
            UPDATE regulatory_documents SET status = 'superseded', superseded_by = :new_id
            WHERE document_family_id = :family_id AND status = 'current'
            RETURNING document_id
            """
        ),
        {"new_id": str(document_id), "family_id": str(family_id)},
    ).scalar_one_or_none()
    conn.execute(
        text(
            """
            UPDATE regulatory_documents
            SET status = 'current', published_by = :by, published_at = :at
            WHERE document_id = :id
            """
        ),
        {"id": str(document_id), "by": published_by, "at": datetime.now(UTC)},
    )
    return superseded


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
                "WHERE document_id = :document_id ORDER BY ordinal"
            ),
            {"document_id": str(document_id)},
        ).mappings().all()
    return [dict(row) for row in rows]
