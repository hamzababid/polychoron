-- specs/platform/10-regulatory-knowledge-base-spec.md — "Phase 2 addendum:
-- document lifecycle & configurable ingestion"
-- specs/suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md
--
-- ADDITIVE: new tables, new defaulted/nullable columns, and a backfill
-- that moves the Phase 1 seeded corpus forward as `current` documents.
-- No existing column changes meaning; `regulatory_chunks.embedding`
-- only loosens (NOT NULL -> nullable, for unembedded draft chunks).
--
-- Table ownership (spec 09): regulatory_source_files is written by
-- app-api (raw bytes are too large for a Temporal payload); every other
-- table here is written by agent-service only.

-- ── Source files (app-api-owned) ────────────────────────────────────
CREATE TABLE regulatory_source_files (
    file_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code        TEXT NOT NULL REFERENCES features (feature_code),
    filename             TEXT NOT NULL,
    content_type          TEXT NOT NULL,
    size_bytes             INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256                  TEXT NOT NULL,
    fetched_from_url         TEXT,
    content                   BYTEA NOT NULL,
    uploaded_by                TEXT NOT NULL REFERENCES platform_users (user_id),
    uploaded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Chunking profiles ───────────────────────────────────────────────
CREATE TABLE regulatory_chunking_profiles (
    profile_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code       TEXT NOT NULL REFERENCES features (feature_code),
    name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
    config               JSONB NOT NULL,
    created_by            TEXT NOT NULL REFERENCES platform_users (user_id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (feature_code, name)
);

-- ── Document lifecycle columns ──────────────────────────────────────
-- status is added with DEFAULT 'current' so every existing (Phase 1
-- seeded) row backfills as current, then the default flips to 'draft':
-- from here on every new document starts life as a draft.
ALTER TABLE regulatory_documents
    ADD COLUMN status TEXT NOT NULL DEFAULT 'current'
        CHECK (status IN ('draft', 'current', 'superseded', 'withdrawn'));
ALTER TABLE regulatory_documents ALTER COLUMN status SET DEFAULT 'draft';
UPDATE regulatory_documents SET status = 'superseded' WHERE superseded_by IS NOT NULL;

ALTER TABLE regulatory_documents
    ADD COLUMN document_family_id     UUID,
    ADD COLUMN version_number          INTEGER NOT NULL DEFAULT 1 CHECK (version_number >= 1),
    ADD COLUMN jurisdiction             TEXT NOT NULL DEFAULT 'PK',
    ADD COLUMN language                  TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN tags                       TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN related_typology_codes      TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN retrieval_enabled            BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN retrieval_priority            DOUBLE PRECISION NOT NULL DEFAULT 1.0
        CHECK (retrieval_priority >= 0.5 AND retrieval_priority <= 2.0),
    ADD COLUMN notes                          TEXT,
    ADD COLUMN source_method                   TEXT NOT NULL DEFAULT 'seed'
        CHECK (source_method IN ('upload', 'paste', 'url', 'manual', 'seed')),
    ADD COLUMN source_file_id                   UUID REFERENCES regulatory_source_files (file_id),
    ADD COLUMN chunking_config                   JSONB,
    -- Draft-only working copy of the extracted source text; chunk
    -- preview reads it from here so large text never crosses Temporal.
    ADD COLUMN extracted_text                     TEXT,
    ADD COLUMN published_by                        TEXT REFERENCES platform_users (user_id),
    ADD COLUMN published_at                         TIMESTAMPTZ,
    ADD COLUMN withdrawn_by                          TEXT REFERENCES platform_users (user_id),
    ADD COLUMN withdrawn_at                           TIMESTAMPTZ,
    ADD COLUMN withdrawal_reason                       TEXT;

UPDATE regulatory_documents
SET document_family_id = document_id,
    published_by = ingested_by,
    published_at = ingested_at
WHERE document_family_id IS NULL;

-- A superseded Phase 1 row's replacement joins its family.
UPDATE regulatory_documents newer
SET document_family_id = older.document_family_id,
    version_number = older.version_number + 1
FROM regulatory_documents older
WHERE older.superseded_by = newer.document_id;

ALTER TABLE regulatory_documents ALTER COLUMN document_family_id SET NOT NULL;

ALTER TABLE regulatory_documents
    ADD CONSTRAINT regulatory_documents_withdrawal_reason_chk
        CHECK (status <> 'withdrawn' OR length(trim(coalesce(withdrawal_reason, ''))) > 0);

-- At most one current and one open draft per family.
CREATE UNIQUE INDEX regulatory_documents_one_current_per_family
    ON regulatory_documents (document_family_id) WHERE status = 'current';
CREATE UNIQUE INDEX regulatory_documents_one_draft_per_family
    ON regulatory_documents (document_family_id) WHERE status = 'draft';
CREATE UNIQUE INDEX regulatory_documents_family_version
    ON regulatory_documents (document_family_id, version_number);
CREATE INDEX regulatory_documents_status_idx ON regulatory_documents (feature_code, status);

-- ── Chunk columns ───────────────────────────────────────────────────
ALTER TABLE regulatory_chunks
    ADD COLUMN ordinal                     INTEGER,
    ADD COLUMN char_count                   INTEGER,
    ADD COLUMN injection_flags               TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN injection_acknowledged_by      TEXT REFERENCES platform_users (user_id),
    ADD COLUMN injection_acknowledged_at       TIMESTAMPTZ;

-- Phase 1 stored no document order. Best proxy: the first number in
-- section_reference ("Section 7" < "Section 7A" < "Section 34" —
-- numeric, not alphabetical), then the reference text itself.
UPDATE regulatory_chunks c
SET ordinal = ranked.rn,
    char_count = length(c.text)
FROM (
    SELECT chunk_id, row_number() OVER (
        PARTITION BY document_id
        ORDER BY (substring(section_reference FROM '[0-9]+'))::int NULLS LAST, section_reference COLLATE "C", chunk_id
    ) AS rn
    FROM regulatory_chunks
) ranked
WHERE ranked.chunk_id = c.chunk_id;

ALTER TABLE regulatory_chunks ALTER COLUMN ordinal SET NOT NULL;
ALTER TABLE regulatory_chunks ALTER COLUMN char_count SET NOT NULL;
ALTER TABLE regulatory_chunks ALTER COLUMN embedding DROP NOT NULL;
CREATE UNIQUE INDEX regulatory_chunks_document_ordinal ON regulatory_chunks (document_id, ordinal);

-- ── Metadata change log (append-only) ───────────────────────────────
CREATE TABLE regulatory_document_changes (
    change_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id       UUID NOT NULL REFERENCES regulatory_documents (document_id),
    field_name         TEXT NOT NULL,
    old_value           TEXT,
    new_value            TEXT,
    changed_by            TEXT NOT NULL REFERENCES platform_users (user_id),
    changed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason                  TEXT NOT NULL CHECK (length(trim(reason)) > 0)
);
CREATE INDEX regulatory_document_changes_document_idx ON regulatory_document_changes (document_id, changed_at);

-- ── Data-layer guarantees ───────────────────────────────────────────
-- Constitution rule 8: a case's stored chunk_id must keep resolving to
-- the exact text it cited, so published chunk content is immutable
-- here, not just in the API. The only escape hatch is an explicit,
-- transaction-scoped `SET LOCAL polychoron.kb_maintenance = 'on'`,
-- used by test cleanup — never by application code paths.

CREATE FUNCTION regulatory_kb_maintenance_mode() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('polychoron.kb_maintenance', true), '') = 'on'
$$;

CREATE FUNCTION regulatory_chunks_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    doc_status TEXT;
BEGIN
    IF regulatory_kb_maintenance_mode() THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    SELECT status INTO doc_status FROM regulatory_documents
    WHERE document_id = coalesce(NEW.document_id, OLD.document_id);

    IF TG_OP = 'INSERT' THEN
        IF doc_status <> 'draft' THEN
            RAISE EXCEPTION 'regulatory chunks can only be added to a draft document (status=%)', doc_status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF doc_status <> 'draft' THEN
            RAISE EXCEPTION 'chunks of a % document are retained, never deleted', doc_status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    ELSE
        IF doc_status <> 'draft' AND (
            NEW.text IS DISTINCT FROM OLD.text
            OR NEW.section_reference IS DISTINCT FROM OLD.section_reference
            OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
            OR NEW.document_id IS DISTINCT FROM OLD.document_id
        ) THEN
            RAISE EXCEPTION 'published regulatory chunk content is immutable (status=%) — create a new version', doc_status
                USING ERRCODE = 'check_violation';
        END IF;
        -- Embedding refresh (re-embed) and injection acknowledgement
        -- stay allowed on any status.
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER regulatory_chunks_guard
    BEFORE INSERT OR UPDATE OR DELETE ON regulatory_chunks
    FOR EACH ROW EXECUTE FUNCTION regulatory_chunks_guard();

CREATE FUNCTION regulatory_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF regulatory_kb_maintenance_mode() THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.document_family_id IS NULL THEN
            NEW.document_family_id := NEW.document_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'a % regulatory document is retained, never deleted — only drafts can be discarded', OLD.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE: only forward lifecycle transitions.
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'draft' AND NEW.status = 'current')
        OR (OLD.status = 'current' AND NEW.status IN ('superseded', 'withdrawn'))
    ) THEN
        RAISE EXCEPTION 'invalid regulatory document transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.document_family_id IS DISTINCT FROM OLD.document_family_id
       OR NEW.version_number IS DISTINCT FROM OLD.version_number THEN
        RAISE EXCEPTION 'a regulatory document''s family/version is fixed at creation'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Publishing requires every chunk to be embedded, and at least one chunk.
    IF OLD.status = 'draft' AND NEW.status = 'current' THEN
        IF NOT EXISTS (SELECT 1 FROM regulatory_chunks WHERE document_id = NEW.document_id) THEN
            RAISE EXCEPTION 'cannot publish a regulatory document with no chunks'
                USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM regulatory_chunks WHERE document_id = NEW.document_id AND embedding IS NULL) THEN
            RAISE EXCEPTION 'cannot publish: some chunks are not embedded yet'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER regulatory_documents_guard
    BEFORE INSERT OR UPDATE OR DELETE ON regulatory_documents
    FOR EACH ROW EXECUTE FUNCTION regulatory_documents_guard();

CREATE FUNCTION regulatory_document_changes_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF regulatory_kb_maintenance_mode() THEN
        RETURN coalesce(NEW, OLD);
    END IF;
    RAISE EXCEPTION 'regulatory_document_changes is append-only'
        USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER regulatory_document_changes_append_only
    BEFORE UPDATE OR DELETE ON regulatory_document_changes
    FOR EACH ROW EXECUTE FUNCTION regulatory_document_changes_append_only();
