"""Mirrors specs/platform/10-regulatory-knowledge-base-spec.md exactly."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class RegulatorySourceType(str, Enum):
    STATUTE = "statute"
    REGULATION = "regulation"
    CIRCULAR = "circular"
    GUIDANCE = "guidance"
    INTERNATIONAL = "international"


class RegulatoryDocument(BaseModel):
    """One ingested regulatory source, versioned."""

    document_id: UUID = Field(default_factory=uuid4)
    feature_code: str
    title: str
    source_type: RegulatorySourceType
    issuing_authority: str
    version_label: str
    effective_date: datetime | None = None
    superseded_by: UUID | None = None
    source_url: str | None = None
    ingested_at: datetime = Field(default_factory=datetime.utcnow)
    ingested_by: str


class RegulatoryChunk(BaseModel):
    """A retrievable passage. The embedding lives in the DB (pgvector
    column), not duplicated in this API-facing model."""

    chunk_id: UUID = Field(default_factory=uuid4)
    document_id: UUID
    section_reference: str
    text: str


class RegulatoryCitation(BaseModel):
    """Attached to an agent's output when it grounds a claim in
    retrieved regulatory text. Supporting context, never itself a
    suspicion determination (constitution-addendum A5)."""

    chunk_id: UUID
    document_title: str
    section_reference: str
    relevance_score: float = Field(..., ge=0, le=1)
