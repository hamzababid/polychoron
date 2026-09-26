"""Regulatory Knowledge Base document lifecycle — the DB work behind
every awaited command (specs/platform/10-regulatory-knowledge-base-spec.md,
"Phase 2 addendum"). app-api reaches these only through commands.py's
Temporal workflows; agent-service owns writes to these tables (spec 09).

Every public function runs in a single transaction and raises a
KbError subclass for business-rule failures, which commands.py turns
into a non-retryable Temporal ApplicationError that app-api maps to an
HTTP status. Migration 013's triggers and unique indexes remain the
backstop underneath all of this."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Connection, text

from app.db import engine
from app.platform.guardrails.sanitize import detect_injection_patterns
from app.platform.regulatory.chunking import (
    ChunkDraft,
    annotate_warnings,
    chunk_text,
    normalize_text,
)
from app.platform.regulatory.extraction import extract_text
from app.platform.regulatory.repository import _publish
from app.platform.regulatory.types import ChunkingConfig

MAX_CHUNK_PAYLOAD_BYTES = 1_500_000
_EXCERPT_CHARS = 1000

# Fields a draft PATCH / a live metadata correction may touch. Chunk
# text and section references are deliberately absent: published chunk
# content is immutable (constitution rule 8).
METADATA_FIELDS = {
    "title": "text",
    "source_type": "text",
    "issuing_authority": "text",
    "version_label": "text",
    "effective_date": "date",
    "source_url": "text",
    "jurisdiction": "text",
    "language": "text",
    "tags": "list",
    "related_typology_codes": "list",
    "notes": "text",
    "retrieval_enabled": "bool",
    "retrieval_priority": "float",
}
_SOURCE_TYPES = {"statute", "regulation", "circular", "guidance", "international"}
_PUBLISH_REQUIRED = ("title", "issuing_authority", "version_label", "source_url")


class KbError(Exception):
    kind = "Invalid"

    def __init__(self, message: str, **details: Any) -> None:
        super().__init__(message)
        self.details = details


class KbInvalid(KbError):
    kind = "Invalid"


class KbNotFound(KbError):
    kind = "NotFound"


class KbConflict(KbError):
    kind = "Conflict"


# ── Drafts ───────────────────────────────────────────────────────────


def create_draft(
    *,
    feature_code: str,
    created_by: str,
    source_method: str,
    supersedes_document_id: str | None = None,
    copy_chunks: bool = False,
    metadata: dict | None = None,
) -> dict:
    """New document (a fresh family) or the next version of an existing
    one. A new version is pre-filled with the source's metadata and,
    with copy_chunks, its chunks *and their embeddings* — unchanged
    chunks never need re-embedding."""
    if source_method not in {"upload", "paste", "url", "manual"}:
        raise KbInvalid(f"unknown source_method {source_method!r}")
    with engine.begin() as conn:
        if supersedes_document_id:
            source = _load(conn, supersedes_document_id, feature_code=feature_code, lock=True)
            if source["status"] != "current":
                raise KbConflict(f"only the current version can get a new version (this one is {source['status']})")
            existing = conn.execute(
                text("SELECT document_id FROM regulatory_documents WHERE document_family_id = :f AND status = 'draft'"),
                {"f": source["document_family_id"]},
            ).scalar_one_or_none()
            if existing:
                raise KbConflict("this document already has an open draft", existing_draft_id=str(existing))
            version = conn.execute(
                text("SELECT max(version_number) + 1 FROM regulatory_documents WHERE document_family_id = :f"),
                {"f": source["document_family_id"]},
            ).scalar_one()
            new_id = conn.execute(
                text(
                    """
                    INSERT INTO regulatory_documents (
                        feature_code, title, source_type, issuing_authority, version_label, effective_date,
                        source_url, ingested_by, status, document_family_id, version_number, jurisdiction,
                        language, tags, related_typology_codes, retrieval_enabled, retrieval_priority, notes,
                        source_method, chunking_config
                    )
                    SELECT feature_code, title, source_type, issuing_authority, version_label, effective_date,
                           source_url, :by, 'draft', document_family_id, :version, jurisdiction,
                           language, tags, related_typology_codes, retrieval_enabled, retrieval_priority, notes,
                           :method, chunking_config
                    FROM regulatory_documents WHERE document_id = :src
                    RETURNING document_id
                    """
                ),
                {"by": created_by, "version": version, "method": source_method, "src": supersedes_document_id},
            ).scalar_one()
            if copy_chunks:
                conn.execute(
                    text(
                        """
                        INSERT INTO regulatory_chunks (document_id, section_reference, text, embedding, ordinal, char_count,
                                                       injection_flags, injection_acknowledged_by, injection_acknowledged_at)
                        SELECT :new_id, section_reference, text, embedding, ordinal, char_count,
                               injection_flags, injection_acknowledged_by, injection_acknowledged_at
                        FROM regulatory_chunks WHERE document_id = :src
                        """
                    ),
                    {"new_id": str(new_id), "src": supersedes_document_id},
                )
        else:
            new_id = conn.execute(
                text(
                    """
                    INSERT INTO regulatory_documents
                        (feature_code, title, source_type, issuing_authority, version_label, ingested_by, status, source_method)
                    VALUES (:feature_code, 'Untitled draft', 'guidance', '', '', :by, 'draft', :method)
                    RETURNING document_id
                    """
                ),
                {"feature_code": feature_code, "by": created_by, "method": source_method},
            ).scalar_one()

        if metadata:
            _apply_metadata(conn, str(new_id), metadata)
        return {"document_id": str(new_id)}


def update_draft(*, document_id: str, feature_code: str, metadata: dict) -> dict:
    """Draft metadata edits need no reason — a draft isn't live."""
    with engine.begin() as conn:
        _require_draft(conn, document_id, feature_code)
        _apply_metadata(conn, document_id, metadata)
        if "chunking_config" in metadata:
            conn.execute(
                text("UPDATE regulatory_documents SET chunking_config = cast(:c as jsonb) WHERE document_id = :id"),
                {"c": json.dumps(ChunkingConfig(**metadata["chunking_config"]).model_dump(mode="json")), "id": document_id},
            )
    return {"document_id": document_id}


def set_source_file(*, document_id: str, feature_code: str, file_id: str) -> dict:
    """Reads the bytes app-api stored in regulatory_source_files (they
    never cross Temporal), extracts text onto the draft."""
    with engine.begin() as conn:
        _require_draft(conn, document_id, feature_code)
        file = conn.execute(
            text(
                "SELECT content, content_type, fetched_from_url FROM regulatory_source_files "
                "WHERE file_id = :id AND feature_code = :f"
            ),
            {"id": file_id, "f": feature_code},
        ).mappings().one_or_none()
        if file is None:
            raise KbNotFound(f"no source file {file_id}")
        result = extract_text(bytes(file["content"]), file["content_type"])
        conn.execute(
            text(
                """
                UPDATE regulatory_documents
                SET extracted_text = :t, source_file_id = :file_id, source_method = :method,
                    source_url = coalesce(nullif(source_url, ''), :fetched_from)
                WHERE document_id = :id
                """
            ),
            {
                "t": result.text,
                "file_id": file_id,
                "method": "url" if file["fetched_from_url"] else "upload",
                "fetched_from": file["fetched_from_url"],
                "id": document_id,
            },
        )
    return _source_summary(result.text, result.page_count)


def set_source_text(*, document_id: str, feature_code: str, source_text: str) -> dict:
    normalized = normalize_text(source_text)
    if not normalized:
        raise KbInvalid("pasted text is empty")
    with engine.begin() as conn:
        _require_draft(conn, document_id, feature_code)
        conn.execute(
            text(
                "UPDATE regulatory_documents SET extracted_text = :t, source_method = 'paste', source_file_id = NULL "
                "WHERE document_id = :id"
            ),
            {"t": normalized, "id": document_id},
        )
    return _source_summary(normalized, None)


def chunk_preview(*, document_id: str, feature_code: str, chunking_config: dict) -> dict:
    """Deterministic, no LLM: replaces the draft's chunks with fresh,
    unembedded previews of its extracted text."""
    config = ChunkingConfig(**chunking_config)
    with engine.begin() as conn:
        draft = _require_draft(conn, document_id, feature_code)
        if not draft["extracted_text"]:
            raise KbInvalid("this draft has no source text yet — add a source first")
        chunks = chunk_text(draft["extracted_text"], config, title=draft["title"])
        if not chunks:
            raise KbInvalid("chunking produced no chunks")
        conn.execute(
            text("UPDATE regulatory_documents SET chunking_config = cast(:c as jsonb) WHERE document_id = :id"),
            {"c": json.dumps(config.model_dump(mode="json")), "id": document_id},
        )
        _replace_chunks(conn, document_id, chunks, keep_embeddings=False)
        return _chunks_result(conn, document_id, config.min_chunk_chars, config.max_chunk_chars)


def save_chunks(*, document_id: str, feature_code: str, chunks: list[dict]) -> dict:
    """The whole ordered chunk list (manual entry + every preview
    adjustment). A chunk whose text is unchanged keeps its embedding and
    its injection acknowledgement."""
    if len(json.dumps(chunks).encode()) > MAX_CHUNK_PAYLOAD_BYTES:
        raise KbInvalid("chunk list too large for one save (1.5 MB) — split the document into several")
    drafts = []
    for i, c in enumerate(chunks, start=1):
        ref, body = (c.get("section_reference") or "").strip(), (c.get("text") or "").strip()
        if not ref or not body:
            raise KbInvalid(f"chunk {i} needs both a section reference and text")
        drafts.append(ChunkDraft(section_reference=ref, text=body))
    if not drafts:
        raise KbInvalid("a document needs at least one chunk")
    with engine.begin() as conn:
        draft = _require_draft(conn, document_id, feature_code)
        config = draft["chunking_config"] or {}
        _replace_chunks(conn, document_id, drafts, keep_embeddings=True)
        return _chunks_result(conn, document_id, config.get("min_chunk_chars", 120), config.get("max_chunk_chars", 2000))


def acknowledge_injection(*, document_id: str, feature_code: str, chunk_id: str, acknowledged_by: str) -> dict:
    with engine.begin() as conn:
        _require_draft(conn, document_id, feature_code)
        updated = conn.execute(
            text(
                """
                UPDATE regulatory_chunks SET injection_acknowledged_by = :by, injection_acknowledged_at = :at
                WHERE chunk_id = :chunk_id AND document_id = :id AND cardinality(injection_flags) > 0
                RETURNING chunk_id
                """
            ),
            {"by": acknowledged_by, "at": datetime.now(UTC), "chunk_id": chunk_id, "id": document_id},
        ).scalar_one_or_none()
        if updated is None:
            raise KbNotFound(f"no flagged chunk {chunk_id} in this draft")
    return {"chunk_id": chunk_id}


def discard_draft(*, document_id: str, feature_code: str) -> dict:
    """Drafts are the only deletable state — nothing can cite them.
    Returns the source file id so app-api (its owner) can delete it."""
    with engine.begin() as conn:
        draft = _require_draft(conn, document_id, feature_code)
        conn.execute(text("DELETE FROM regulatory_chunks WHERE document_id = :id"), {"id": document_id})
        conn.execute(text("DELETE FROM regulatory_documents WHERE document_id = :id"), {"id": document_id})
    source_file_id = draft["source_file_id"]
    return {"document_id": document_id, "source_file_id": str(source_file_id) if source_file_id else None}


def publish_draft(*, document_id: str, feature_code: str, published_by: str) -> dict:
    with engine.begin() as conn:
        draft = _load(conn, document_id, feature_code=feature_code, lock=True)
        if draft["status"] != "draft":
            raise KbConflict(f"only a draft can be published (this one is {draft['status']})")
        missing = [f for f in _PUBLISH_REQUIRED if not (draft[f] or "").strip()]
        if missing:
            raise KbInvalid(f"fill in {', '.join(missing)} before publishing", missing_fields=missing)
        stats = conn.execute(
            text(
                """
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE embedding IS NULL) AS unembedded,
                       count(*) FILTER (WHERE cardinality(injection_flags) > 0
                                        AND injection_acknowledged_by IS NULL) AS unacknowledged
                FROM regulatory_chunks WHERE document_id = :id
                """
            ),
            {"id": document_id},
        ).mappings().one()
        if stats["total"] == 0:
            raise KbInvalid("a document needs at least one chunk before publishing")
        if stats["unembedded"]:
            raise KbConflict(f"{stats['unembedded']} chunk(s) are not embedded yet — run embedding first")
        if stats["unacknowledged"]:
            raise KbConflict(f"{stats['unacknowledged']} chunk(s) have unacknowledged injection flags")
        superseded = _publish(conn, document_id=UUID(document_id), published_by=published_by)
        conn.execute(text("UPDATE regulatory_documents SET extracted_text = NULL WHERE document_id = :id"), {"id": document_id})
    return {"document_id": document_id, "superseded_document_id": str(superseded) if superseded else None}


# ── Live documents ───────────────────────────────────────────────────


def correct_metadata(*, document_id: str, feature_code: str, changes: dict, reason: str, changed_by: str) -> dict:
    """In-place correction of a published document's metadata — reason
    required, one append-only change-log row per changed field."""
    if not (reason or "").strip():
        raise KbInvalid("a reason is required to correct a published document")
    unknown = set(changes) - set(METADATA_FIELDS)
    if unknown:
        raise KbInvalid(f"these fields can't be corrected here: {', '.join(sorted(unknown))}")
    with engine.begin() as conn:
        doc = _load(conn, document_id, feature_code=feature_code, lock=True)
        if doc["status"] == "draft":
            raise KbConflict("drafts are edited directly, not corrected")
        if doc["status"] == "superseded":
            raise KbConflict("a superseded version is a historical record and can't be corrected")
        changed = {f: v for f, v in _coerce_metadata(changes).items() if _as_text(doc[f]) != _as_text(v)}
        if not changed:
            raise KbInvalid("nothing changed")
        _apply_metadata(conn, document_id, changed)
        now = datetime.now(UTC)
        for field_name, value in changed.items():
            conn.execute(
                text(
                    """
                    INSERT INTO regulatory_document_changes
                        (document_id, field_name, old_value, new_value, changed_by, changed_at, reason)
                    VALUES (:id, :field, :old, :new, :by, :at, :reason)
                    """
                ),
                {
                    "id": document_id,
                    "field": field_name,
                    "old": _as_text(doc[field_name]),
                    "new": _as_text(value),
                    "by": changed_by,
                    "at": now,
                    "reason": reason.strip(),
                },
            )
    return {"document_id": document_id, "changed_fields": sorted(changed)}


def withdraw(*, document_id: str, feature_code: str, reason: str, withdrawn_by: str) -> dict:
    if not (reason or "").strip():
        raise KbInvalid("a reason is required to withdraw a document")
    with engine.begin() as conn:
        doc = _load(conn, document_id, feature_code=feature_code, lock=True)
        if doc["status"] != "current":
            raise KbConflict(f"only the current version can be withdrawn (this one is {doc['status']})")
        conn.execute(
            text(
                """
                UPDATE regulatory_documents
                SET status = 'withdrawn', withdrawn_by = :by, withdrawn_at = :at, withdrawal_reason = :reason
                WHERE document_id = :id
                """
            ),
            {"by": withdrawn_by, "at": datetime.now(UTC), "reason": reason.strip(), "id": document_id},
        )
    return {"document_id": document_id}


# ── Embedding (the one background job) ──────────────────────────────


def list_unembedded_chunks(document_id: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT chunk_id, text FROM regulatory_chunks WHERE document_id = :id AND embedding IS NULL ORDER BY ordinal"),
            {"id": document_id},
        ).mappings().all()
    return [{"chunk_id": str(r["chunk_id"]), "text": r["text"]} for r in rows]


# ── Internals ────────────────────────────────────────────────────────


def _load(conn: Connection, document_id: str, *, feature_code: str, lock: bool = False) -> dict:
    try:
        UUID(document_id)
    except ValueError as exc:
        raise KbNotFound(f"no regulatory document {document_id}") from exc
    row = conn.execute(
        text(
            "SELECT * FROM regulatory_documents WHERE document_id = :id AND feature_code = :f"
            + (" FOR UPDATE" if lock else "")
        ),
        {"id": document_id, "f": feature_code},
    ).mappings().one_or_none()
    if row is None:
        raise KbNotFound(f"no regulatory document {document_id}")
    return dict(row)


def _require_draft(conn: Connection, document_id: str, feature_code: str) -> dict:
    doc = _load(conn, document_id, feature_code=feature_code, lock=True)
    if doc["status"] != "draft":
        raise KbConflict(f"this document is {doc['status']}, not a draft — start a new version to change it")
    return doc


def _coerce_metadata(metadata: dict) -> dict:
    out: dict[str, Any] = {}
    for field_name, value in metadata.items():
        if field_name == "chunking_config":
            continue
        kind = METADATA_FIELDS.get(field_name)
        if kind is None:
            raise KbInvalid(f"unknown metadata field {field_name!r}")
        if kind == "text":
            value = None if value is None else str(value).strip()
            if field_name == "source_type" and value not in _SOURCE_TYPES:
                raise KbInvalid(f"source_type must be one of {', '.join(sorted(_SOURCE_TYPES))}")
            if field_name in ("title", "source_type", "issuing_authority", "version_label", "jurisdiction", "language"):
                value = value or ""
                if field_name in ("title", "source_type") and not value:
                    raise KbInvalid(f"{field_name} can't be empty")
            if field_name == "source_url" and value and not value.lower().startswith(("http://", "https://")):
                raise KbInvalid("source_url must be an http(s) link to the official publication")
        elif kind == "list":
            value = sorted({str(v).strip() for v in (value or []) if str(v).strip()})
        elif kind == "bool":
            value = bool(value)
        elif kind == "float":
            value = float(value)
            if not 0.5 <= value <= 2.0:
                raise KbInvalid("retrieval_priority must be between 0.5 and 2.0")
        elif kind == "date":
            value = date.fromisoformat(str(value)[:10]) if value else None
        out[field_name] = value
    return out


def _apply_metadata(conn: Connection, document_id: str, metadata: dict) -> None:
    values = _coerce_metadata(metadata)
    if not values:
        return
    assignments = ", ".join(f"{f} = :{f}" for f in values)
    conn.execute(text(f"UPDATE regulatory_documents SET {assignments} WHERE document_id = :document_id"), {**values, "document_id": document_id})


def _replace_chunks(conn: Connection, document_id: str, chunks: list[ChunkDraft], *, keep_embeddings: bool) -> None:
    previous: dict[str, dict] = {}
    if keep_embeddings:
        for row in conn.execute(
            text(
                "SELECT text, embedding::text AS embedding, injection_acknowledged_by, injection_acknowledged_at "
                "FROM regulatory_chunks WHERE document_id = :id"
            ),
            {"id": document_id},
        ).mappings():
            previous[row["text"]] = dict(row)
    conn.execute(text("DELETE FROM regulatory_chunks WHERE document_id = :id"), {"id": document_id})
    for ordinal, chunk in enumerate(chunks, start=1):
        kept = previous.get(chunk.text, {})
        flags = detect_injection_patterns(chunk.text)
        conn.execute(
            text(
                """
                INSERT INTO regulatory_chunks (document_id, section_reference, text, embedding, ordinal, char_count,
                                               injection_flags, injection_acknowledged_by, injection_acknowledged_at)
                VALUES (:id, :ref, :text, cast(:embedding as vector), :ordinal, :chars, :flags, :ack_by, :ack_at)
                """
            ),
            {
                "id": document_id,
                "ref": chunk.section_reference,
                "text": chunk.text,
                "embedding": kept.get("embedding"),
                "ordinal": ordinal,
                "chars": len(chunk.text),
                "flags": flags,
                "ack_by": kept.get("injection_acknowledged_by") if flags else None,
                "ack_at": kept.get("injection_acknowledged_at") if flags else None,
            },
        )


def _chunks_result(conn: Connection, document_id: str, min_chars: int, max_chars: int) -> dict:
    rows = conn.execute(
        text(
            """
            SELECT chunk_id, section_reference, text, ordinal, char_count, injection_flags,
                   injection_acknowledged_by, embedding IS NOT NULL AS embedded
            FROM regulatory_chunks WHERE document_id = :id ORDER BY ordinal
            """
        ),
        {"id": document_id},
    ).mappings().all()
    drafts = annotate_warnings(
        [ChunkDraft(section_reference=r["section_reference"], text=r["text"]) for r in rows], min_chars=min_chars, max_chars=max_chars
    )
    chunks = [
        {
            "chunk_id": str(r["chunk_id"]),
            "ordinal": r["ordinal"],
            "section_reference": r["section_reference"],
            "text": r["text"],
            "char_count": r["char_count"],
            "embedded": r["embedded"],
            "warnings": d.warnings,
            "injection_flags": list(r["injection_flags"]),
            "injection_acknowledged": r["injection_acknowledged_by"] is not None,
        }
        for r, d in zip(rows, drafts, strict=True)
    ]
    return {
        "chunks": chunks,
        "total_chars": sum(c["char_count"] for c in chunks),
        "warning_count": sum(len(c["warnings"]) for c in chunks),
        "unacknowledged_injection_count": sum(1 for c in chunks if c["injection_flags"] and not c["injection_acknowledged"]),
    }


def _source_summary(extracted: str, page_count: int | None) -> dict:
    return {"char_count": len(extracted), "page_count": page_count, "excerpt": extracted[:_EXCERPT_CHARS]}


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, list | tuple):
        return json.dumps(sorted(value))
    if isinstance(value, datetime | date):
        return value.isoformat()[:10]
    return str(value)
