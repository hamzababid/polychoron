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
        list_unembedded_chunks_activity,
        publish_document_activity,
        reembed_chunk_activity,
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

        # The draft already joined the superseded document's family
        # (ingest_document_activity), so publishing supersedes it.
        await workflow.execute_activity(
            publish_document_activity,
            {"document_id": document_id, "published_by": payload["ingested_by"]},
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_RETRY_POLICY,
        )

        return {"document_id": document_id, "chunk_ids": chunk_ids}


@workflow.defn(name="RegulatoryReembedWorkflow")
class RegulatoryReembedWorkflow:
    """payload: {document_id}. Re-runs embedding generation for every
    existing chunk of a document in place — e.g. after an embedding-
    model change. Never touches chunk text. Returns {reembedded_count}.
    Progress via the `progress` query."""

    def __init__(self) -> None:
        self._done = 0
        self._total = 0

    @workflow.query
    def progress(self) -> dict:
        return {"done": self._done, "total": self._total}

    @workflow.run
    async def run(self, payload: dict) -> dict:
        chunks = await workflow.execute_activity(
            list_chunks_activity,
            payload["document_id"],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_RETRY_POLICY,
        )

        self._total = len(chunks)
        for chunk in chunks:
            await workflow.execute_activity(
                reembed_chunk_activity,
                chunk,
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_RETRY_POLICY,
            )
            self._done += 1

        return {"reembedded_count": len(chunks)}


@workflow.defn(name="RegulatoryEmbedDraftWorkflow")
class RegulatoryEmbedDraftWorkflow:
    """The Regulatory KB's one user-visible background job (spec 10,
    "Pipeline"): one embeddings call per draft chunk that doesn't have an
    embedding yet — chunks copied unchanged from a previous version keep
    theirs. payload: {document_id}. Progress via the `progress` query.
    Returns {embedded_count}."""

    def __init__(self) -> None:
        self._done = 0
        self._total = 0

    @workflow.query
    def progress(self) -> dict:
        return {"done": self._done, "total": self._total}

    @workflow.run
    async def run(self, payload: dict) -> dict:
        chunks = await workflow.execute_activity(
            list_unembedded_chunks_activity,
            payload["document_id"],
            start_to_close_timeout=_ACTIVITY_TIMEOUT,
            retry_policy=_RETRY_POLICY,
        )
        self._total = len(chunks)
        for chunk in chunks:
            await workflow.execute_activity(
                reembed_chunk_activity,
                chunk,
                start_to_close_timeout=_ACTIVITY_TIMEOUT,
                retry_policy=_RETRY_POLICY,
            )
            self._done += 1
        return {"embedded_count": self._done}
