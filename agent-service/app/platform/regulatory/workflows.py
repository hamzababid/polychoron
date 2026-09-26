"""Temporal workflows for the Regulatory Knowledge Base's ingestion
pipeline. app-api's regulatory-kb endpoints start these via the
Temporal TS client and poll workflow status — never a direct HTTP call
into agent-service, per
specs/platform/09-backend-service-boundary-spec.md.

Workflow code stays free of non-workflow-safe imports (no DB/HTTP
clients here, only activity calls), same discipline as
features/aml_detection/workflows.py."""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from app.platform.regulatory.activities import (
        ingest_chunk_activity,
        ingest_document_activity,
        list_chunks_activity,
        reembed_chunk_activity,
        supersede_document_activity,
    )

_ACTIVITY_TIMEOUT = timedelta(seconds=30)
_RETRY_POLICY = RetryPolicy(maximum_attempts=3)


@workflow.defn(name="RegulatoryDocumentIngestionWorkflow")
class RegulatoryDocumentIngestionWorkflow:
    """payload: {feature_code, title, source_type, issuing_authority,
    version_label, source_url?, ingested_by, chunks: [{section_reference, text}],
    supersedes_document_id?}. Returns {document_id, chunk_ids}."""

    @workflow.run
    async def run(self, payload: dict) -> dict:
        document_id = await workflow.execute_activity(
            ingest_document_activity,
            payload,
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_RETRY_POLICY,
        )

        chunk_ids: list[str] = []
        for chunk in payload["chunks"]:
            chunk_id = await workflow.execute_activity(
                ingest_chunk_activity,
                {"document_id": document_id, **chunk},
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_RETRY_POLICY,
            )
            chunk_ids.append(chunk_id)

        supersedes_document_id = payload.get("supersedes_document_id")
        if supersedes_document_id:
            await workflow.execute_activity(
                supersede_document_activity,
                {"old_document_id": supersedes_document_id, "new_document_id": document_id},
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_RETRY_POLICY,
            )

        return {"document_id": document_id, "chunk_ids": chunk_ids}


@workflow.defn(name="RegulatoryReembedWorkflow")
class RegulatoryReembedWorkflow:
    """payload: {document_id}. Re-runs embedding generation for every
    existing chunk of a document in place — e.g. after an embedding-
    model change. Never touches chunk text. Returns {reembedded_count}."""

    @workflow.run
    async def run(self, payload: dict) -> dict:
        chunks = await workflow.execute_activity(
            list_chunks_activity,
            payload["document_id"],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_RETRY_POLICY,
        )

        for chunk in chunks:
            await workflow.execute_activity(
                reembed_chunk_activity,
                chunk,
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_RETRY_POLICY,
            )

        return {"reembedded_count": len(chunks)}
