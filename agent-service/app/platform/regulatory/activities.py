"""Temporal activities backing the Regulatory Knowledge Base's
ingestion pipeline (specs/platform/10-regulatory-knowledge-base-spec.md's
"Migration note" — the full pipeline TASKS.md's Regulatory KB block
deferred to Phase 2). app-api triggers these via
RegulatoryDocumentIngestionWorkflow/RegulatoryReembedWorkflow rather
than calling agent-service directly — same "NestJS never calls an LLM
directly" boundary alert ingestion already respects
(specs/platform/09-backend-service-boundary-spec.md), since chunking a
document means generating embeddings."""

from __future__ import annotations

from uuid import UUID

from temporalio import activity

from app.platform.regulatory.repository import (
    ingest_chunk,
    ingest_document,
    list_chunks,
    reembed_chunk,
    supersede_document,
)
from app.platform.regulatory.types import RegulatorySourceType


@activity.defn
def ingest_document_activity(payload: dict) -> str:
    document_id = ingest_document(
        feature_code=payload["feature_code"],
        title=payload["title"],
        source_type=RegulatorySourceType(payload["source_type"]),
        issuing_authority=payload["issuing_authority"],
        version_label=payload["version_label"],
        ingested_by=payload["ingested_by"],
        source_url=payload.get("source_url"),
    )
    return str(document_id)


@activity.defn
def ingest_chunk_activity(payload: dict) -> str:
    chunk_id = ingest_chunk(
        document_id=UUID(payload["document_id"]),
        section_reference=payload["section_reference"],
        chunk_text=payload["text"],
    )
    return str(chunk_id)


@activity.defn
def supersede_document_activity(payload: dict) -> None:
    supersede_document(old_document_id=UUID(payload["old_document_id"]), new_document_id=UUID(payload["new_document_id"]))


@activity.defn
def list_chunks_activity(document_id: str) -> list[dict]:
    return [{"chunk_id": str(c["chunk_id"]), "text": c["text"]} for c in list_chunks(UUID(document_id))]


@activity.defn
def reembed_chunk_activity(payload: dict) -> None:
    reembed_chunk(chunk_id=UUID(payload["chunk_id"]), chunk_text=payload["text"])


ALL_REGULATORY_ACTIVITIES = [
    ingest_document_activity,
    ingest_chunk_activity,
    supersede_document_activity,
    list_chunks_activity,
    reembed_chunk_activity,
]
