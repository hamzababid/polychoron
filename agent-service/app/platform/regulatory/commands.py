"""Awaited commands for the Regulatory Knowledge Base
(specs/platform/10-regulatory-knowledge-base-spec.md, "Pipeline — one
background job, everything else awaited").

agent-service owns writes to the KB tables and app-api may only reach
it through Temporal (spec 09), but none of these steps is slow — so
app-api runs each as a short workflow with `workflow.execute()` and
returns the result inside the same HTTP request. No job id, no polling.

Each workflow wraps exactly one activity. Business-rule failures
(lifecycle.KbError, extraction/chunking errors, trigger violations)
become a non-retryable ApplicationError whose `type` is Conflict /
NotFound / Invalid; app-api maps that to 409 / 404 / 400."""

from __future__ import annotations

from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from sqlalchemy.exc import IntegrityError, InternalError

    from app.platform.regulatory import lifecycle
    from app.platform.regulatory.chunking import ChunkingError
    from app.platform.regulatory.extraction import ExtractionError
    from app.platform.regulatory.preview import preview_regulatory_retrieval

_TIMEOUT = timedelta(seconds=25)
_RETRY = RetryPolicy(maximum_attempts=3)


def _run(fn, payload: dict):
    try:
        return fn(**payload)
    except lifecycle.KbError as exc:
        raise ApplicationError(str(exc), exc.details, type=exc.kind, non_retryable=True) from exc
    except (ExtractionError, ChunkingError) as exc:
        raise ApplicationError(str(exc), {}, type="Invalid", non_retryable=True) from exc
    except (IntegrityError, InternalError) as exc:
        # Migration 013's triggers / unique indexes — the backstop.
        message = str(getattr(exc, "orig", exc)).split("\n", 1)[0]
        raise ApplicationError(message, {}, type="Conflict", non_retryable=True) from exc
    except (ValueError, TypeError) as exc:
        raise ApplicationError(str(exc), {}, type="Invalid", non_retryable=True) from exc


_DRAFT_OPS = {
    "create": lifecycle.create_draft,
    "update": lifecycle.update_draft,
    "save_chunks": lifecycle.save_chunks,
    "acknowledge_injection": lifecycle.acknowledge_injection,
    "discard": lifecycle.discard_draft,
}
_METADATA_OPS = {"correct": lifecycle.correct_metadata, "withdraw": lifecycle.withdraw}


@activity.defn
def kb_extract_activity(payload: dict) -> dict:
    if "file_id" in payload:
        return _run(lifecycle.set_source_file, payload)
    return _run(lifecycle.set_source_text, payload)


@activity.defn
def kb_chunk_preview_activity(payload: dict) -> dict:
    return _run(lifecycle.chunk_preview, payload)


@activity.defn
def kb_draft_activity(payload: dict) -> dict:
    op = payload.pop("op")
    return _run(_DRAFT_OPS[op], payload)


@activity.defn
def kb_publish_activity(payload: dict) -> dict:
    return _run(lifecycle.publish_draft, payload)


@activity.defn
def kb_metadata_activity(payload: dict) -> dict:
    op = payload.pop("op")
    return _run(_METADATA_OPS[op], payload)


@activity.defn
def kb_retrieval_preview_activity(payload: dict) -> dict:
    return {"results": _run(preview_regulatory_retrieval, payload)}


async def _execute(activity_fn, payload: dict) -> dict:
    """Re-raises the activity's ApplicationError as the workflow's own
    failure, so app-api sees Conflict/NotFound/Invalid directly rather
    than digging through an ActivityError wrapper."""
    try:
        return await workflow.execute_activity(activity_fn, payload, start_to_close_timeout=_TIMEOUT, retry_policy=_RETRY)
    except ActivityError as exc:
        cause = exc.cause
        if isinstance(cause, ApplicationError):
            raise ApplicationError(cause.message, *cause.details, type=cause.type, non_retryable=True) from exc
        raise


@workflow.defn(name="RegulatoryExtractCommand")
class RegulatoryExtractCommand:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await _execute(kb_extract_activity, payload)


@workflow.defn(name="RegulatoryChunkPreviewCommand")
class RegulatoryChunkPreviewCommand:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await _execute(kb_chunk_preview_activity, payload)


@workflow.defn(name="RegulatoryDraftCommand")
class RegulatoryDraftCommand:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await _execute(kb_draft_activity, payload)


@workflow.defn(name="RegulatoryPublishCommand")
class RegulatoryPublishCommand:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await _execute(kb_publish_activity, payload)


@workflow.defn(name="RegulatoryMetadataCommand")
class RegulatoryMetadataCommand:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await _execute(kb_metadata_activity, payload)


@workflow.defn(name="RegulatoryRetrievalPreviewCommand")
class RegulatoryRetrievalPreviewCommand:
    @workflow.run
    async def run(self, payload: dict) -> dict:
        return await _execute(kb_retrieval_preview_activity, payload)


ALL_KB_COMMAND_WORKFLOWS = [
    RegulatoryExtractCommand,
    RegulatoryChunkPreviewCommand,
    RegulatoryDraftCommand,
    RegulatoryPublishCommand,
    RegulatoryMetadataCommand,
    RegulatoryRetrievalPreviewCommand,
]
ALL_KB_COMMAND_ACTIVITIES = [
    kb_extract_activity,
    kb_chunk_preview_activity,
    kb_draft_activity,
    kb_publish_activity,
    kb_metadata_activity,
    kb_retrieval_preview_activity,
]
