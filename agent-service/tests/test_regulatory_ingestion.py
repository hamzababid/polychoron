"""Regulatory Knowledge Base management screen backend —
specs/platform/10-regulatory-knowledge-base-spec.md's deferred
ingestion pipeline. The repository-level tests below need no live LLM
(list/supersede are plain DB operations); the workflow-level test does
real embedding calls and needs the worker actually running, so it's
opt-in via RUN_LIVE_LLM_TESTS=1, same gate as
test_regulatory_repository.py."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text

from app.db import get_connection
from app.platform.regulatory.repository import (
    ingest_document,
    list_chunks,
    list_documents,
)
from app.platform.regulatory.types import RegulatorySourceType


@pytest.fixture()
def kb_user(test_tenant):
    user_id = f"test-user-{uuid.uuid4().hex[:8]}"
    with get_connection() as conn:
        conn.execute(
            text("INSERT INTO platform_users (user_id, tenant_id, display_name, email, role_codes) VALUES (:u, :t, :d, :e, :r)"),
            {"u": user_id, "t": test_tenant["tenant_id"], "d": "Test MLRO", "e": "kb-mlro@test.local", "r": ["aml_detection.mlro_compliance_head"]},
        )
        conn.commit()
    yield user_id
    with get_connection() as conn:
        conn.execute(text("DELETE FROM platform_users WHERE user_id = :u"), {"u": user_id})
        conn.commit()


@pytest.fixture()
def kb_document(kb_user, test_tenant):
    document_id = ingest_document(
        feature_code=test_tenant["feature_code"],
        title=f"Test Document {uuid.uuid4().hex[:6]}",
        source_type=RegulatorySourceType.GUIDANCE,
        issuing_authority="Test Authority",
        version_label="v1",
        ingested_by=kb_user,
    )
    yield document_id
    with get_connection() as conn:
        conn.execute(text("DELETE FROM regulatory_chunks WHERE document_id = :d"), {"d": str(document_id)})
        conn.execute(text("DELETE FROM regulatory_documents WHERE document_id = :d"), {"d": str(document_id)})
        conn.commit()


def test_list_documents_includes_chunk_count(test_tenant, kb_document):
    documents = list_documents(test_tenant["feature_code"])
    match = next(d for d in documents if d["document_id"] == kb_document)
    assert match["chunk_count"] == 0
    assert match["superseded_by"] is None


def test_list_chunks_empty_for_new_document(kb_document):
    assert list_chunks(kb_document) == []


def test_new_document_starts_as_draft(kb_document):
    documents = list_documents("aml_detection")
    assert any(d["document_id"] == kb_document for d in documents)
    with get_connection() as conn:
        status = conn.execute(text("SELECT status FROM regulatory_documents WHERE document_id = :d"), {"d": str(kb_document)}).scalar_one()
    assert status == "draft"


pytestmark_live = pytest.mark.skipif(
    not os.environ.get("RUN_LIVE_LLM_TESTS"),
    reason="Requires the worker running and a real OPENAI_API_KEY — opt in with RUN_LIVE_LLM_TESTS=1",
)


@pytestmark_live
@pytest.mark.asyncio
async def test_ingestion_workflow_creates_document_and_embedded_chunks(test_tenant, kb_user):
    from temporalio.client import Client

    from app.config import settings

    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    workflow_id = f"test-regulatory-ingestion-{uuid.uuid4().hex[:8]}"
    payload = {
        "feature_code": test_tenant["feature_code"],
        "title": "Live Ingestion Test Document",
        "source_type": "guidance",
        "issuing_authority": "Test Authority",
        "version_label": "v1",
        "ingested_by": kb_user,
        "chunks": [
            {"section_reference": "Section 1", "text": "Multiple cash deposits just under the reporting threshold."},
        ],
    }

    result = await client.execute_workflow(
        "RegulatoryDocumentIngestionWorkflow",
        payload,
        id=workflow_id,
        task_queue=settings.temporal_task_queue,
    )

    document_id = result["document_id"]
    assert len(result["chunk_ids"]) == 1

    chunks = list_chunks(document_id)
    assert len(chunks) == 1

    # Published (current) rows are retained by migration 013's triggers;
    # test cleanup uses the explicit maintenance override.
    with get_connection() as conn:
        conn.execute(text("SET LOCAL polychoron.kb_maintenance = 'on'"))
        conn.execute(text("DELETE FROM regulatory_chunks WHERE document_id = :d"), {"d": document_id})
        conn.execute(text("DELETE FROM regulatory_documents WHERE document_id = :d"), {"d": document_id})
        conn.commit()
