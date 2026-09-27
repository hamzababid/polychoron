-- specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
-- ("Typology lifecycle (v2)") + decision #5 in
-- phase-2-full-aml/api-contracts-phase2.md.
--
-- The first Typology Console build edited aml_typology_configs in
-- place, and the Pattern Matching Agent reads that table — so every
-- edit went live on save and "promote" only moved a version number.
-- From here, configs hold identity only; everything the agent sees
-- lives on a version row, and the agent reads the promoted one.
-- Promotion is gated on a passing golden-dataset regression run for
-- the exact draft content (constitution rule 15), enforced below as
-- well as in app-api.

-- ── Content hash ────────────────────────────────────────────────────
-- A regression run is keyed to "typology:<code>:v<version>:<hash12>",
-- so editing a draft after its run invalidates the run. Computed here
-- (generated column) so app-api and agent-service can't disagree on it.
-- IMMUTABLE is safe: the database encoding is fixed at UTF8.

CREATE FUNCTION aml_typology_content_hash(label TEXT, description TEXT, is_active BOOLEAN) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(label || E'\x1f' || description || E'\x1f' || is_active::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION aml_typology_candidate_key(code TEXT, version INTEGER, content_hash TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT 'typology:' || code || ':v' || version || ':' || left(content_hash, 12)
$$;

-- ── Versions carry the content ──────────────────────────────────────

ALTER TABLE aml_typology_config_versions
    ADD COLUMN typology_label  TEXT,
    ADD COLUMN status          TEXT,
    ADD COLUMN discarded_by    TEXT REFERENCES platform_users (user_id),
    ADD COLUMN discarded_at    TIMESTAMPTZ,
    ADD COLUMN discard_reason  TEXT;

UPDATE aml_typology_config_versions v
SET typology_label = c.typology_label
FROM aml_typology_configs c
WHERE c.typology_code = v.typology_code;

-- The latest version of each typology is what the agent has actually
-- been reading (v1 edits went straight onto the config row), so it
-- becomes the promoted one; everything earlier is superseded.
UPDATE aml_typology_config_versions v
SET status = CASE WHEN v.version = latest.max_version THEN 'promoted' ELSE 'superseded' END
FROM (
    SELECT typology_code, max(version) AS max_version
    FROM aml_typology_config_versions
    GROUP BY typology_code
) latest
WHERE latest.typology_code = v.typology_code;

ALTER TABLE aml_typology_config_versions
    ALTER COLUMN typology_label SET NOT NULL,
    ALTER COLUMN status SET NOT NULL,
    ADD CONSTRAINT aml_typology_config_versions_status_check
        CHECK (status IN ('draft', 'promoted', 'superseded', 'discarded')),
    ADD CONSTRAINT aml_typology_config_versions_label_check
        CHECK (length(trim(typology_label)) > 0),
    ADD CONSTRAINT aml_typology_config_versions_description_check
        CHECK (length(trim(rule_logic_description)) > 0),
    -- A draft may still be working towards its reason; anything that
    -- has left draft must say why it changed.
    ADD CONSTRAINT aml_typology_config_versions_reason_check
        CHECK (status IN ('draft', 'discarded') OR length(trim(change_reason)) > 0),
    ADD CONSTRAINT aml_typology_config_versions_discard_check
        CHECK (status <> 'discarded' OR (
            discarded_by IS NOT NULL AND discarded_at IS NOT NULL
            AND length(trim(coalesce(discard_reason, ''))) > 0
        ));

ALTER TABLE aml_typology_config_versions
    ADD COLUMN content_hash TEXT NOT NULL
        GENERATED ALWAYS AS (aml_typology_content_hash(typology_label, rule_logic_description, active)) STORED;

CREATE UNIQUE INDEX aml_typology_config_versions_one_draft
    ON aml_typology_config_versions (typology_code) WHERE status = 'draft';
CREATE UNIQUE INDEX aml_typology_config_versions_one_promoted
    ON aml_typology_config_versions (typology_code) WHERE status = 'promoted';

-- ── Configs hold identity only ──────────────────────────────────────

ALTER TABLE aml_typology_configs
    ADD COLUMN created_by TEXT REFERENCES platform_users (user_id);

UPDATE aml_typology_configs c
SET created_by = v.changed_by
FROM aml_typology_config_versions v
WHERE v.typology_code = c.typology_code AND v.version = 1;

-- A config with no version history (shouldn't exist, but never guess
-- an author) falls back to the seed user that wrote the v1 catalog.
UPDATE aml_typology_configs c
SET created_by = 'demo-mlro-1'
WHERE created_by IS NULL;

-- production_version follows the backfilled promoted version; null
-- means never promoted, i.e. not in the agent's catalog.
UPDATE aml_typology_configs c
SET production_version = v.version
FROM aml_typology_config_versions v
WHERE v.typology_code = c.typology_code AND v.status = 'promoted';

ALTER TABLE aml_typology_configs
    ALTER COLUMN created_by SET NOT NULL,
    ALTER COLUMN production_version DROP DEFAULT,
    ALTER COLUMN production_version DROP NOT NULL,
    ADD CONSTRAINT aml_typology_configs_production_version_fk
        FOREIGN KEY (typology_code, production_version)
        REFERENCES aml_typology_config_versions (typology_code, version),
    DROP COLUMN typology_label,
    DROP COLUMN rule_logic_description,
    DROP COLUMN active;

-- ── Promotions record why, and against which regression run ─────────

ALTER TABLE aml_typology_promotions
    ADD COLUMN reason       TEXT,
    ADD COLUMN eval_run_id  UUID REFERENCES platform_eval_runs (run_id),
    ADD COLUMN pre_v2       BOOLEAN NOT NULL DEFAULT false;

-- v1 accepted a promote reason and dropped it; say so rather than
-- inventing one.
UPDATE aml_typology_promotions
SET reason = '(recorded before v2 — reason not stored)', pre_v2 = true;

ALTER TABLE aml_typology_promotions
    ALTER COLUMN reason SET NOT NULL,
    ADD CONSTRAINT aml_typology_promotions_reason_check CHECK (length(trim(reason)) > 0),
    ADD CONSTRAINT aml_typology_promotions_eval_run_check CHECK (eval_run_id IS NOT NULL OR pre_v2),
    ADD CONSTRAINT aml_typology_promotions_version_fk
        FOREIGN KEY (typology_code, promoted_version)
        REFERENCES aml_typology_config_versions (typology_code, version);

-- ── Traceability: which rule text produced a match ──────────────────

ALTER TABLE aml_typology_matches ADD COLUMN typology_version INTEGER;

-- ── Data-layer guarantees ───────────────────────────────────────────
-- Same shape as migration 013's KB guards: application code goes
-- through the lifecycle, and the only escape hatch is an explicit,
-- transaction-scoped `SET LOCAL polychoron.typology_maintenance = 'on'`
-- — used by the baseline seed and by test cleanup, never by an API path.

CREATE FUNCTION aml_typology_maintenance_mode() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('polychoron.typology_maintenance', true), '') = 'on'
$$;

CREATE FUNCTION aml_typology_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF aml_typology_maintenance_mode() THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'a typology version starts as a draft (got status=%)', NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'typology versions are retained, never deleted — discard a draft instead'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.typology_code IS DISTINCT FROM OLD.typology_code OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'a typology version''s identity is immutable'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Content only changes while a row is, and stays, a draft — so a
    -- single UPDATE can't edit a draft and promote it at once.
    IF (OLD.status <> 'draft' OR NEW.status <> 'draft') AND (
        NEW.typology_label IS DISTINCT FROM OLD.typology_label
        OR NEW.rule_logic_description IS DISTINCT FROM OLD.rule_logic_description
        OR NEW.active IS DISTINCT FROM OLD.active
        OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
        OR NEW.changed_by IS DISTINCT FROM OLD.changed_by
        OR NEW.changed_at IS DISTINCT FROM OLD.changed_at
    ) THEN
        RAISE EXCEPTION 'typology version content is immutable once % — open a new draft', OLD.status
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
        (OLD.status = 'draft' AND NEW.status IN ('promoted', 'discarded'))
        OR (OLD.status = 'promoted' AND NEW.status = 'superseded')
    ) THEN
        RAISE EXCEPTION 'invalid typology version transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- Promotion goes through aml_typology_promotions, whose own guard
    -- checks the regression run; a bare status flip can't skip it.
    IF OLD.status = 'draft' AND NEW.status = 'promoted' AND NOT EXISTS (
        SELECT 1 FROM aml_typology_promotions p
        JOIN platform_eval_runs r ON r.run_id = p.eval_run_id
        WHERE p.typology_code = NEW.typology_code AND p.promoted_version = NEW.version
          AND r.status = 'passed'
          -- OLD, not NEW: generated columns aren't computed yet in a
          -- BEFORE trigger, and content can't change on leaving draft.
          AND r.agent_version_under_test = aml_typology_candidate_key(OLD.typology_code, OLD.version, OLD.content_hash)
    ) THEN
        RAISE EXCEPTION 'typology % v% has no promotion record with a passing regression run for its content',
            NEW.typology_code, NEW.version
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER aml_typology_versions_guard
    BEFORE INSERT OR UPDATE OR DELETE ON aml_typology_config_versions
    FOR EACH ROW EXECUTE FUNCTION aml_typology_versions_guard();

CREATE FUNCTION aml_typology_promotions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v RECORD;
    run RECORD;
BEGIN
    IF aml_typology_maintenance_mode() THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'typology promotions are append-only'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.pre_v2 THEN
        RAISE EXCEPTION 'pre_v2 marks promotions recorded before migration 014 only'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT status, content_hash INTO v FROM aml_typology_config_versions
    WHERE typology_code = NEW.typology_code AND version = NEW.promoted_version;
    IF v.status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'only a draft can be promoted (typology % v% is %)',
            NEW.typology_code, NEW.promoted_version, coalesce(v.status, 'missing')
            USING ERRCODE = 'check_violation';
    END IF;

    -- Constitution rule 15: the regression must have run against this
    -- exact draft content and passed.
    SELECT status, agent_version_under_test INTO run FROM platform_eval_runs WHERE run_id = NEW.eval_run_id;
    IF run.status IS DISTINCT FROM 'passed'
        OR run.agent_version_under_test IS DISTINCT FROM
            aml_typology_candidate_key(NEW.typology_code, NEW.promoted_version, v.content_hash) THEN
        RAISE EXCEPTION 'typology % v% needs a passing golden-dataset regression run for its current content',
            NEW.typology_code, NEW.promoted_version
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER aml_typology_promotions_guard
    BEFORE INSERT OR UPDATE OR DELETE ON aml_typology_promotions
    FOR EACH ROW EXECUTE FUNCTION aml_typology_promotions_guard();

CREATE FUNCTION aml_typology_configs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF aml_typology_maintenance_mode() THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'typologies are retired, never deleted'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.production_version IS NOT NULL THEN
            RAISE EXCEPTION 'a new typology is not live until promoted'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.typology_code IS DISTINCT FROM OLD.typology_code
        OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'a typology''s identity is immutable'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.production_version IS DISTINCT FROM OLD.production_version AND NOT EXISTS (
        SELECT 1 FROM aml_typology_config_versions
        WHERE typology_code = NEW.typology_code AND version = NEW.production_version AND status = 'promoted'
    ) THEN
        RAISE EXCEPTION 'production_version must point at the promoted version'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER aml_typology_configs_guard
    BEFORE INSERT OR UPDATE OR DELETE ON aml_typology_configs
    FOR EACH ROW EXECUTE FUNCTION aml_typology_configs_guard();
