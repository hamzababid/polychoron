# Phase 2 — API Contracts (Full AML Feature Set)
**AML Detection's Phase 2 API surface — namespaced under
`/api/v1/features/aml_detection/` per platform convention, same as
Phase 1. This file exists per `TASKS.md`'s instruction to write it
before expanding Phase 2 into task-level detail.**

Written after reading all five Phase 2 screen specs in full. Three
scope decisions were made explicitly with the project owner before
writing this (recorded here so they're not re-litigated per screen) —
#4 was added later, same discipline:

1. **RBAC for Typology Console / Model Governance**: `mvp-phases.md`
   scopes the full platform RBAC/SSO system to Phase 3, but these two
   screens need `platform.model_risk_audit` and
   `platform.external_examiner` (defined in
   `platform/05-rbac-platform-spec.md`). Decision: extend the existing
   Phase 1 demo-login stub with two more seeded demo users carrying
   these roles — no real SSO, no time-boxed/auto-expiring examiner
   credentials (that mechanism stays Phase 3 scope). This is the same
   stub, not a second one.
2. **Screening Hub's TFS freeze action**: needs a real core-banking
   endpoint that doesn't exist yet (only the Phase 1/2 mock bank
   exists). Decision: build the full screen; the freeze action is
   present but server-side disabled, returning `501 Not Implemented`
   with a clear message — never a silent no-op, per the screen spec's
   own instruction.
3. **Reporting & MI's regulatory export**: no real SBP bi-annual
   submission format available. Decision: generic PDF/CSV period
   export only for Phase 2; the SBP-specific template is added later
   once compliance provides it.

4. **Regulatory Knowledge Base management** (added 2026-09-26, after
   the first single-page KB screen shipped): proper routed screens
   (Library / Add wizard / Document view / Edit / Compare) replace the
   inline-expansion page. Content edits are **versioned drafts** —
   published chunk text is never mutated (constitution rule 8);
   metadata corrections are in place with a required reason. All four
   ingestion sources are in scope (PDF/DOCX/TXT upload, pasted text,
   single human-triggered URL fetch, manual chunks). Any
   `mlro_compliance_head` may publish — no maker-checker until Phase 3
   RBAC. Built from the existing AML design system, no Claude Design
   export. Full detail: `screens/11-regulatory-knowledge-base.md` and
   the Phase 2 addendum in `platform/10-regulatory-knowledge-base-spec.md`.

## New data models this phase adds
(Extends `specs/suites/bfsi/features/aml-detection/data-models.py`.
`SamplingReview` already existed in that file but had no table until
now — Phase 1's migration comment explicitly deferred it.)

- **`TypologyConfig`**: `typology_code` (PK), `typology_label`,
  `rule_logic_description`, `active`, `production_version`,
  `created_at`. Replaces Phase 1's hardcoded, in-repo
  `agent-service/app/features/aml_detection/typology_catalog.py` as
  the Pattern Matching Agent's "typology config lookup" tool — Phase 1
  anticipated this swap explicitly.
- **`TypologyConfigVersion`**: append-only version/change history —
  `typology_code`, `version`, `rule_logic_description`, `active`,
  `changed_by`, `changed_at`, `change_reason`. Every edit *and* every
  active/inactive toggle writes one row (screen spec: "toggling
  active/inactive is itself a change requiring the same version-history
  logging as a rule-logic edit").
- **`TypologyBacktestJob`**: `job_id`, `typology_code`, `status`
  (`queued`/`running`/`complete`/`failed`), `started_at`,
  `completed_at`, `comparison_report` (jsonb — agreement rate vs.
  production, broken out by typology, per
  `agent-implementation.md`'s shadow-mode spec).
- **`TypologyPromotion`**: `typology_code`, `promoted_version`,
  `backtest_job_id` (nullable — but a null here must be visibly
  flagged per the screen's acceptance criteria, never silently
  allowed), `promoted_by`, `promoted_at`.
- **`ScreeningHit`**: a dedicated queue entity, not just the
  `ScreeningResult` embedded in `EvidenceBundle` — `hit_id`,
  `customer_id`, `list_source`, `matched_name`, `match_confidence`,
  `match_rationale`, `status` (`held`/`true_match`/`false_match`/`escalated`),
  `held_since`, `disposition_officer_id`, `disposition_reason`,
  `decided_at`.
- **`SamplingReview`**: as already specified in `data-models.py` — the
  table is added now. A `sampling_selection` job flags a configurable
  percentage of newly-CLEARED dispositions for review (simple random
  sample for Phase 2 — no stratification yet).
- Customer 360's "accounts list": **no new `Account` table.** The mock
  bank has never modeled accounts as first-class entities with their
  own attributes (type, status, etc.) — only as ID strings on
  `InboundAlert.account_ids` and `TransactionRecord`. Fabricating
  account metadata that doesn't exist anywhere would be dishonest
  demo data. Customer 360's accounts list is a *derived* view: distinct
  account IDs across a customer's cases, with which cases reference
  each. Revisit if a real core-banking accounts feed ever exists
  (Phase 3).

## Typology & Rules Console
`GET /api/v1/features/aml_detection/typologies` → `TypologyConfig[]`
with computed metrics (`alert_volume_30d`, `str_conversion_rate`,
`false_positive_rate`) joined from `Case`/`Disposition`, not
hand-maintained columns.
`GET /api/v1/features/aml_detection/typologies/{code}/history` → `TypologyConfigVersion[]`
`POST /api/v1/features/aml_detection/typologies/{code}/backtest` → starts a `TypologyBacktestJob`, returns `job_id`
`GET /api/v1/features/aml_detection/typologies/backtest-jobs/{job_id}` → job status + `comparison_report` once complete
`POST /api/v1/features/aml_detection/typologies/{code}/promote` → Body: `{backtest_job_id?, reason}` — `platform.mlro_compliance_head` only (feature-level `aml_detection.mlro_compliance_head`, per role-manifest.md — the console's RBAC line in the screen spec names the bare role; this repo's actual role codes are feature-namespaced, same as every other Phase 1 endpoint)

## Sanctions & PEP Screening Hub
`GET /api/v1/features/aml_detection/screening/hits?status=held` → paginated `ScreeningHit[]`
`GET /api/v1/features/aml_detection/screening/hits/{hit_id}` → detail, with side-by-side customer vs. watchlist field comparison
`POST /api/v1/features/aml_detection/screening/hits/{hit_id}/disposition` → Body: `{disposition: 'true_match'|'false_match'|'escalate', officer_id, reason}`
  - `true_match` → attempts the TFS freeze action → **`501 Not Implemented`**, `{message: "Core-banking freeze integration not yet available — case flagged for manual freeze outside this system"}`. The disposition itself (and its audit entry) is still recorded; only the automated freeze call is blocked.
  - Every disposition (including `false_match`) writes an audit entry with officer identity, per the screen's acceptance criteria.

## Customer 360
`GET /api/v1/features/aml_detection/customers/{customer_id}/360` → `{kyc (latest snapshot across cases), accounts (derived), priorCases, screeningHistory, linkedEntities (aggregated across all this customer's cases)}`
Read-only — no write endpoints on this route, per the screen's acceptance criteria.

## Model Governance & Audit
`GET /api/v1/features/aml_detection/governance/sampling` → `SamplingReview[]` + aggregate agreement-rate trend over time
`POST /api/v1/features/aml_detection/governance/sampling/{case_id}/review` → Body: `SamplingReview` fields — records a reviewer's agree/disagree
`GET /api/v1/features/aml_detection/governance/consistency` → STR conversion rate by typology, broken out by branch
`GET /api/v1/features/aml_detection/governance/model-versions` → current `agent_version` per node (evidence/pattern/narrative), read from agent-service's node classes, with change history from `platform_agent_activity_log`
`GET /api/v1/features/aml_detection/governance/data-lineage` → status + last-refresh timestamp per upstream dependency (Phase 1/2 honesty: this lists the **mock** bank API, Temporal, and the OpenAI-backed inference provider — not fictional "core banking"/"sanctions list" systems that don't exist yet)
RBAC: `aml_detection.mlro_compliance_head`, `platform.model_risk_audit`, `platform.external_examiner` (read-only — sampling data only, never full case content, per the screen's acceptance criteria)

## Reporting & MI
`GET /api/v1/features/aml_detection/reports/summary?period=&compare_previous=` → same aggregation `DashboardService` already computes, at full granularity (this is the "single source of truth" the Dashboard's basic summary is a rollup of — both must read from the same computation, never diverge)
`POST /api/v1/features/aml_detection/reports/generate` → Body: `{period, format: 'pdf'|'csv'}` (no `sbp_biannual` format option yet — see decision #3 above), async job, returns `report_id`
`GET /api/v1/features/aml_detection/reports/history` → previously generated reports, each re-downloadable byte-for-byte (persisted file, not regenerated on request)
`GET /api/v1/features/aml_detection/reports/{report_id}/download`
RBAC: `aml_detection.mlro_compliance_head`

## Regulatory Knowledge Base
Prefix: `/api/v1/features/aml_detection/regulatory-kb`. RBAC on every
route, read and write: `aml_detection.mlro_compliance_head`.
**Only embedding is a background job** (`embed`, `reembed` return a
`jobId`). Every other write is an *awaited command*: app-api runs a
short Temporal workflow on the agent-service worker and returns its
result in the same HTTP response — no job id, no polling (see the
pipeline section of `platform/10-regulatory-knowledge-base-spec.md`).
`GET .../jobs/{jobId}` → `{jobId, kind: embed|reembed, status: running|completed|failed, progress: {done, total}, error?}`
(replaces `.../ingestion-jobs/{jobId}`, which stays as an alias until
the old screen is removed).

**Library & read**
`GET .../documents?status=&source_type=&issuing_authority=&tag=&q=&page=&page_size=` → paginated `{items, total, page, pageSize, statusCounts}` (**shape change**: was a bare array — only the KB screen consumes it, updated in the same change)
`GET .../documents/{id}` → full metadata incl. lifecycle fields, source file info, chunking config, family summary
`GET .../documents/{id}/chunks?q=` → ordered by `ordinal`, each with `citedByCaseCount`
`GET .../documents/{id}/versions` → every document in the family, newest first
`GET .../documents/{id}/changes` → metadata change log
`GET .../documents/{id}/citations?page=` → cases citing any chunk of this document
`GET .../documents/{id}/compare/{otherId}` → metadata diff + chunk diff (409 if not the same family)
`GET .../documents/{id}/source-file` → original bytes, `Content-Disposition` download
`GET .../chunking-profiles`, `POST .../chunking-profiles` → `{name, config}`

**Draft creation & source**
`POST .../drafts` → `{source_method: upload|paste|url|manual, supersedes_document_id?, copy_chunks?}` → creates a `draft`, returns `documentId`. With `supersedes_document_id` it's the next version in that family, pre-filled with its metadata — and with `copy_chunks: true` (Edit → "Edit content") its chunks too, copied with their existing embeddings (only chunks whose text changes, or new chunks, need re-embedding) (409 if that family already has an open draft — response carries the existing draft's id)
`POST .../drafts/{id}/source-file` → multipart upload (pdf/docx/txt, ≤ 20 MB) → app-api stores the bytes, runs extraction (awaited) → `{charCount, pageCount?, excerpt}`
`POST .../drafts/{id}/source-text` → `{text}` (paste) → normalised (awaited) → `{charCount, excerpt}`
`POST .../drafts/{id}/source-url` → `{url}` → app-api fetches once (10 MB, 20 s, http(s) only, private-address guard), stores the bytes, runs extraction (awaited) → `{charCount, pageCount?, excerpt}`
`PATCH .../drafts/{id}` → any metadata + retrieval settings (drafts need no change reason — they're not live)
`POST .../drafts/{id}/chunk-preview` → `{chunking_config}` → (awaited, no LLM) replaces the draft's chunks with unembedded previews → `{chunks, warnings}`
`PUT .../drafts/{id}/chunks` → full ordered chunk list `[{section_reference, text}]` (manual entry and all preview adjustments — merge/split/edit/reorder are client-side, saved as the whole list); returns warnings + injection flags
`POST .../drafts/{id}/chunks/{chunkId}/acknowledge-injection` → `{acknowledged_by}`
`POST .../drafts/{id}/embed` → **background job**, returns `jobId` (embeds only chunks that don't already have an embedding)
`POST .../drafts/{id}/publish` → `{published_by}` → 409 unless every chunk is embedded and every injection flag acknowledged; awaited → the published document
`DELETE .../drafts/{id}` → discard (drafts only — 409 for any other status)

**Live document actions**
`PATCH .../documents/{id}/metadata` → `{changes: {field: value}, reason, changed_by}` → 400 without a non-empty reason; 409 for `superseded`; writes one change-log row per changed field. Chunk text/section reference are **not** accepted here — there is no endpoint that mutates published chunk content
`POST .../documents/{id}/withdraw` → `{reason, withdrawn_by}` → `current` → `withdrawn`
`POST .../documents/{id}/reembed` → *(exists)* **background job**, returns `jobId`
`POST .../retrieval-preview` → `{query, top_k?, include_draft_document_id?}` → awaited `RegulatoryRetrievalPreviewCommand` (≤ 10 s) → ranked `[{chunkId, documentId, documentTitle, sectionReference, text, score}]`

**Kept for compatibility:** `POST .../documents` (one-shot ingest) stays for
scripts/tests; the new screen doesn't use it.

## MLOps tracing (platform-wide, not a screen)
`platform_agent_activity_log` (Phase 1) remains the constitution rule
3 audit-of-record — this doesn't change or get replaced. Phase 2 adds
OpenTelemetry spans for every node execution plus Langfuse spans
specifically for LLM calls (prompt, completion, token cost, latency),
per `agent-implementation.md`. This is additive observability for
debugging/cost-tracking, feeding a richer Agent Activity Log detail
view — not a second source of truth for the audit trail itself.

## What's still explicitly deferred
- Shadow-mode's actual comparison-report computation logic (agreement
  rate by typology) — the job/table shape is specified above; the
  comparison algorithm itself is a task-level detail to work out when
  building the Typology Console.
- Real TFS freeze integration, real SBP report template, real
  platform RBAC/SSO, multi-tenancy — all Phase 3, per `mvp-phases.md`.
