"""Mirrors specs/platform/10-regulatory-knowledge-base-spec.md exactly."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal
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


# ── Phase 2 addendum: document lifecycle & configurable ingestion ────


class RegulatoryDocumentStatus(str, Enum):
    DRAFT = "draft"  # never retrievable; the only deletable state
    CURRENT = "current"  # retrievable if retrieval_enabled
    SUPERSEDED = "superseded"  # retained forever, not retrievable
    WITHDRAWN = "withdrawn"  # repealed with no replacement; retained, not retrievable


class ChunkingStrategy(str, Enum):
    HEADING_PATTERN = "heading_pattern"
    PARAGRAPH = "paragraph"
    FIXED_SIZE = "fixed_size"
    MANUAL = "manual"


class ChunkingConfig(BaseModel):
    strategy: ChunkingStrategy
    heading_pattern: str | None = None  # regex, HEADING_PATTERN only
    target_chunk_chars: int = Field(1200, ge=100, le=20000)
    max_chunk_chars: int = Field(2000, ge=100, le=40000)
    overlap_chars: int = Field(150, ge=0, le=5000)
    min_chunk_chars: int = Field(120, ge=0, le=5000)
    section_reference_mode: Literal["from_heading", "template"] = "from_heading"
    section_reference_template: str | None = None  # e.g. "{title} ¶{n}"
    strip_headers_footers: bool = True
