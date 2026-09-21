-- specs/platform/10-regulatory-knowledge-base-spec.md
-- ADDITIVE to the in-progress build: new platform-level tables (no
-- existing table changes shape) plus two new nullable/defaulted
-- columns. Mechanism is platform-level; content is feature-owned (see
-- regulatory_documents.feature_code).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE regulatory_documents (
    document_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code       TEXT NOT NULL REFERENCES features (feature_code),
    title               TEXT NOT NULL,
    source_type         TEXT NOT NULL
                            CHECK (source_type IN ('statute', 'regulation', 'circular', 'guidance', 'international')),
    issuing_authority    TEXT NOT NULL,
    version_label        TEXT NOT NULL,
    effective_date        TIMESTAMPTZ,
    -- Points forward to the newer document, if retired — retained, not
    -- deleted, so a case decided under an older version stays
    -- explainable (constitution rule 8 / non-negotiable #3).
    superseded_by          UUID REFERENCES regulatory_documents (document_id),
    source_url              TEXT,
    ingested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Document ingestion is human-gated, same accountability trail as
    -- a typology promotion (non-negotiable #2) — never an automated
    -- scrape-and-replace.
    ingested_by               TEXT NOT NULL REFERENCES platform_users (user_id)
);

CREATE INDEX regulatory_documents_feature_idx ON regulatory_documents (feature_code);

-- text-embedding-3-small (the model used by
-- agent-service/app/platform/regulatory/embeddings.py) produces
-- 1536-dimensional vectors.
CREATE TABLE regulatory_chunks (
    chunk_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id           UUID NOT NULL REFERENCES regulatory_documents (document_id),
    section_reference      TEXT NOT NULL,
    text                     TEXT NOT NULL,
    embedding                 vector(1536) NOT NULL
);

CREATE INDEX regulatory_chunks_document_idx ON regulatory_chunks (document_id);
-- ivfflat needs at least a handful of rows to be worth building, but
-- is harmless (and correct) to create even over Phase 1's tiny
-- hand-seeded corpus.
CREATE INDEX regulatory_chunks_embedding_idx ON regulatory_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- Additive, defaulted columns — existing rows and existing code paths
-- that don't know about these fields are unaffected.
ALTER TABLE aml_typology_matches ADD COLUMN regulatory_citations JSONB NOT NULL DEFAULT '[]';
ALTER TABLE aml_case_assessments ADD COLUMN regulatory_context_used JSONB NOT NULL DEFAULT '[]';
