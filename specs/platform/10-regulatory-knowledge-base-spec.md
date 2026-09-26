# Polychoron AI — Regulatory Knowledge Base Spec
### Platform-level mechanism, feature-owned content. ADDITIVE to the already-running build — see "Migration note for the in-progress build" at the end before touching existing code.

## The gap this closes
The Pattern Matching Agent currently matches evidence against typology
*configs* (human-distilled rules in the Typology & Rules Console) — it
has no access to the actual regulatory text those configs are supposed
to implement (AMLA 2010, SBP's AML/CFT/CPF Regulations, FMU's red-flag
indicator documents). This means an agent's output can't cite *why*
something is regulatorily relevant, and there's no systematic way to
notice when a typology config has drifted from the regulation it's
based on.

This spec adds a retrieval layer so agents can ground their reasoning
in actual regulatory text — it does **not** change who makes the
suspicion determination. Retrieved regulatory text is supporting
context for the agent's output, same as evidence from core banking is
— it is never itself the thing that decides reportability.

## Mechanism (platform-level) vs. content (feature-level)
Same split as the model inference router:
- **Platform provides**: the ingestion pipeline, the embedding store
  (reusing `pgvector`, already in the stack — no new infrastructure),
  and the retrieval API every feature's agents call.
- **Features own their own corpus**: AML Detection's corpus is AMLA
  2010, the current SBP AML/CFT/CPF Regulations, and FMU's red-flag
  indicator documents (see
  `suites/bfsi/features/aml-detection/regulatory-corpus-manifest.md`).
  A future second feature would own an entirely different corpus,
  loaded the same way.

## Data model additions (append to `platform/02-platform-data-models.py`)

```python
class RegulatorySourceType(str, Enum):
    STATUTE = "statute"          # e.g. AMLA 2010
    REGULATION = "regulation"    # e.g. SBP AML/CFT/CPF Regulations
    CIRCULAR = "circular"        # SBP circulars/notifications
    GUIDANCE = "guidance"        # FMU red-flag documents, etc.
    INTERNATIONAL = "international"  # FATF guidance, for context only


class RegulatoryDocument(BaseModel):
    """One ingested regulatory source, versioned."""
    document_id: UUID = Field(default_factory=uuid4)
    feature_code: str  # which feature's corpus this belongs to
    title: str  # e.g. "AMLA 2010" or "FMU Red Flags for Banks"
    source_type: RegulatorySourceType
    issuing_authority: str  # "SBP" | "FMU" | "Government of Pakistan" | "FATF"
    version_label: str  # e.g. "as amended 2024"
    effective_date: Optional[datetime] = None
    superseded_by: Optional[UUID] = None  # points to the newer document, if retired
    source_url: Optional[str] = None
    ingested_at: datetime = Field(default_factory=datetime.utcnow)
    ingested_by: str  # human who approved this document's inclusion


class RegulatoryChunk(BaseModel):
    """A retrievable passage. Embedding itself lives in the DB (pgvector
    column), not duplicated in this API-facing model."""
    chunk_id: UUID = Field(default_factory=uuid4)
    document_id: UUID
    section_reference: str  # e.g. "Section 7A(1)" or "Red Flag: Structuring"
    text: str


class RegulatoryCitation(BaseModel):
    """Attached to an agent's output when it grounds a claim in
    retrieved regulatory text. This is supporting context, never itself
    a suspicion determination."""
    chunk_id: UUID
    document_title: str
    section_reference: str
    relevance_score: float = Field(..., ge=0, le=1)
```

## Retrieval contract every agent node calls

```python
def retrieve_regulatory_context(
    feature_code: str, query: str, top_k: int = 5
) -> list[RegulatoryChunk]:
    """Vector-similarity search over this feature's ingested corpus.
    Called by the Pattern Matching Agent (to ground a typology match in
    the actual regulatory indicator text) and optionally the Case &
    Narrative Agent (to reference relevant sections while drafting).
    Never called by a node that makes a suspicion/filing decision —
    there is no such node; that decision stays human, per constitution
    rule 1."""
    ...
```

## Where citations attach (additive fields, both `Optional`/defaulted)
- `TypologyMatch.regulatory_citations: list[RegulatoryCitation] = []`
  — which regulatory passages support this typology match
- `CaseAssessment.regulatory_context_used: list[RegulatoryCitation] = []`
  — what was retrieved and available while drafting, for audit
  transparency, not a claim the narrative is legally conclusive

Both fields default to an empty list — existing code that constructs
these models without the new field keeps working unchanged.

## Non-negotiables
1. **Retrieved regulatory text never determines the suspicion
   decision.** It's evidence the Pattern Matching Agent can cite, same
   status as a transaction record — the human still decides
   reportability, per constitution rule 1.
2. **Document ingestion is human-gated.** Adding or superseding a
   `RegulatoryDocument` requires the same accountability trail as a
   typology promotion — `ingested_by`, logged, not an automated
   scrape-and-replace. (A future *proactive* "watches SBP's website and
   flags drift" capability is explicitly out of scope here — that's
   the Regulatory Intelligence vertical we already scoped out of this
   platform; this spec is the passive retrieval version only.)
3. **Superseded documents are retained, not deleted** (`superseded_by`
   points forward) — consistent with constitution rule 8's versioning
   discipline. A case decided under an older regulation version must
   still be explainable against the text that was actually in force
   when it was decided.
4. **Every retrieval call is logged** as part of the calling agent's
   existing `data_sources_queried` field on
   `PlatformAgentActivityLogEntry` — no new logging mechanism needed,
   this reuses what's already there.

## Feature-level: AML Detection's corpus
See `suites/bfsi/features/aml-detection/regulatory-corpus-manifest.md`
for the initial document list and ingestion process.

## Migration note for the in-progress build
This is designed to be added without disrupting work already underway:
- All new fields are `Optional`/default-valued additions to existing
  models — add via a migration, do not alter existing columns or
  existing endpoint behavior.
- `RegulatoryDocument`/`RegulatoryChunk` are new tables — no existing
  table needs to change shape.
- The retrieval call inside the Pattern Matching Agent node is a new,
  optional step in that node's `run()` implementation — if the agent
  chain is already built and passing its tests, add the retrieval call
  as an additive step (call it, attach citations if any come back,
  proceed as before if the corpus is empty) rather than making it a
  hard dependency that could break an already-working demo path.
- **For Phase 1 / the demo specifically**: a small, hand-seeded corpus
  (the handful of chunks covering structuring and high-velocity-account
  indicators, matching the two seed scenarios already in
  `phase-1-aml-core/mock-bank-integration-spec.md`) is enough to make
  the citation feature visibly work in the demo. Do not build the full
  ingestion pipeline (document upload UI, chunking service, embedding
  refresh jobs) for Phase 1 — that's Phase 2 scope, tracked in
  `TASKS.md`.

---

## Phase 2 addendum — document lifecycle & configurable ingestion
*Added 2026-09-26, decided with the project owner. Screen-level detail
lives in `suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md`;
this section is the platform mechanism only. Still ADDITIVE: new
columns are nullable/defaulted, new tables only, and the Phase 1 seeded
corpus is migrated forward, not re-ingested.*

### Decisions
1. **Edit = versioned drafts.** Published chunk text is immutable
   (constitution rule 8 — a case's stored `chunk_id` must keep
   resolving to the exact text it cited). Content changes create a new
   `draft` document in the same *family*; publishing supersedes the
   previous version. Metadata corrections are in place, reason
   required, change-logged.
2. **Ingestion sources:** file upload (PDF/DOCX/TXT), pasted full text,
   human-triggered single-URL fetch, manual chunks. No scheduled or
   recursive fetching — non-negotiable #2 still stands.
3. **Approval:** any `aml_detection.mlro_compliance_head` may publish;
   no maker-checker (revisit with Phase 3 real RBAC).
4. **Chunking is deterministic and configurable** (heading regex /
   paragraph / fixed size + overlap), previewed and hand-adjustable
   before any embedding call. No LLM-based chunking.

### Data model additions

```python
class RegulatoryDocumentStatus(str, Enum):
    DRAFT = "draft"            # never retrievable; the only deletable state
    CURRENT = "current"        # retrievable if retrieval_enabled
    SUPERSEDED = "superseded"  # retained forever, not retrievable
    WITHDRAWN = "withdrawn"    # repealed with no replacement; retained, not retrievable


class ChunkingStrategy(str, Enum):
    HEADING_PATTERN = "heading_pattern"
    PARAGRAPH = "paragraph"
    FIXED_SIZE = "fixed_size"
    MANUAL = "manual"


class ChunkingConfig(BaseModel):
    strategy: ChunkingStrategy
    heading_pattern: Optional[str] = None      # regex, HEADING_PATTERN only
    target_chunk_chars: int = 1200
    max_chunk_chars: int = 2000
    overlap_chars: int = 150
    min_chunk_chars: int = 120
    section_reference_mode: Literal["from_heading", "template"] = "from_heading"
    section_reference_template: Optional[str] = None  # e.g. "{title} ¶{n}"
    strip_headers_footers: bool = True


class ChunkingProfile(BaseModel):
    """Named, reusable ChunkingConfig — feature-scoped."""
    profile_id: UUID = Field(default_factory=uuid4)
    feature_code: str
    name: str                  # e.g. "SBP Regulations — by Regulation number"
    config: ChunkingConfig
    created_by: str
    created_at: datetime


# RegulatoryDocument — new fields (all defaulted/nullable)
    document_family_id: UUID          # shared by every version of one regulation; defaults to own document_id
    version_number: int = 1           # monotonic within a family
    status: RegulatoryDocumentStatus = RegulatoryDocumentStatus.CURRENT
    jurisdiction: str = "PK"
    language: str = "en"
    tags: list[str] = []
    related_typology_codes: list[str] = []   # empty = applies to all typologies
    retrieval_enabled: bool = True
    retrieval_priority: float = Field(1.0, ge=0.5, le=2.0)
    notes: Optional[str] = None               # internal; never sent to an agent
    source_method: Literal["upload", "paste", "url", "manual", "seed"] = "seed"
    source_file_id: Optional[UUID] = None     # -> RegulatorySourceFile
    chunking_config: Optional[ChunkingConfig] = None
    published_by: Optional[str] = None
    published_at: Optional[datetime] = None
    withdrawn_by: Optional[str] = None
    withdrawn_at: Optional[datetime] = None
    withdrawal_reason: Optional[str] = None


# RegulatoryChunk — new fields
    ordinal: int                       # document order; list/preview order by this, not section_reference
    char_count: int
    embedding: nullable while status == draft and embedding job pending
    injection_flags: list[str] = []    # detect_injection_patterns() hits
    injection_acknowledged_by: Optional[str] = None


class RegulatorySourceFile(BaseModel):
    """Original uploaded/fetched bytes, retained for traceability."""
    file_id: UUID
    filename: str
    content_type: str                  # application/pdf | ...docx | text/plain | text/html
    size_bytes: int
    sha256: str
    fetched_from_url: Optional[str] = None
    uploaded_by: str
    uploaded_at: datetime
    # bytes stored in a bytea column excluded from default SELECTs
    # (same pattern as aml_report_generations.file_content)


class RegulatoryDocumentChange(BaseModel):
    """Append-only metadata-correction log. One row per changed field."""
    change_id: UUID
    document_id: UUID
    field_name: str
    old_value: Optional[str]
    new_value: Optional[str]
    changed_by: str
    changed_at: datetime
    reason: str                        # required — enforced NOT NULL + non-empty CHECK
```

DB-level guarantees (migration `013`):
- Partial unique index: one `current` document per `document_family_id`;
  one `draft` per `document_family_id`.
- Trigger rejecting `UPDATE OF text, section_reference` on
  `regulatory_chunks` and `DELETE` of chunks whose document status is
  not `draft` — immutability enforced at the data layer, not just the
  API (same stance as constitution rule 4).
- `regulatory_document_changes.reason` `CHECK (length(trim(reason)) > 0)`.
- Backfill: existing rows → `status='current'`,
  `document_family_id=document_id`, `version_number=1`,
  `source_method='seed'`; chunks get `ordinal` by current
  `section_reference` order and `char_count`.

### Pipeline — one background job, everything else awaited
Two constraints from `09-backend-service-boundary-spec.md` shape this:
NestJS never calls an LLM (so embedding runs on the agent-service
worker), and table writes are exclusive per service (agent-service
owns `regulatory_documents` / `regulatory_chunks`, so NestJS can't
write them directly). Temporal is the only channel between the two.

That does **not** mean every step is a user-visible job. Only one step
is genuinely slow:

| Kind | Steps | How app-api calls it | What the user sees |
|---|---|---|---|
| **Background job** | Embed a draft's chunks (one embeddings call per chunk — minutes for a large regulation); the existing Re-embed | `workflow.start()` → `jobId`, polled; progress via a workflow **query** | Progress bar (`embedded n / N`), navigable away |
| **Awaited command** | Create draft (incl. new version with copied chunks + embeddings), extract text (upload / paste / URL), chunk preview, save chunk list, acknowledge injection flag, publish, discard draft, correct metadata, withdraw, retrieval preview | `workflow.execute()` — starts and awaits the result inside the HTTP request (timeout 30 s; URL fetch and large-PDF extraction are the only ones expected to take more than ~1 s) | A normal button click / spinner — no job id, no polling |

Awaited commands are short Temporal workflows, one per command, defined
in `app/platform/regulatory/commands.py`, each wrapping one activity
that does its DB work in a single transaction. Failures surface as a
normal HTTP error with the activity's message.

**Table ownership additions** (extends spec 09's table):

| Owned by NestJS (writes) | Owned by Python service (writes) |
|---|---|
| `regulatory_source_files` (raw upload / fetched bytes) | `regulatory_documents`, `regulatory_chunks` (as today) |
| | `regulatory_document_changes`, `regulatory_chunking_profiles` |

`regulatory_source_files` belongs to NestJS because an upload can be
20 MB and Temporal payloads are capped around 2 MB. NestJS stores the
bytes, then passes only the `file_id` to the extraction command, which
reads them from Postgres. **URL fetch uses the same path**: fetching a
URL is not an LLM call, so NestJS performs the one-off fetch itself
(10 MB cap, 20 s timeout, http(s) only, private-address guard), stores
the bytes in `regulatory_source_files` with `fetched_from_url` set, and
calls the same extraction command. One extraction path for both.

| Workflow | Kind | LLM? |
|---|---|---|
| `RegulatoryEmbedDraftWorkflow` | background job | yes — `get_embedding()` per chunk |
| `RegulatoryReembedWorkflow` *(exists)* | background job | yes |
| `RegulatoryExtractCommand` | awaited | no |
| `RegulatoryChunkPreviewCommand` | awaited | no |
| `RegulatoryDraftCommand` (create / save chunks / acknowledge / discard) | awaited | no |
| `RegulatoryPublishCommand` (draft → `current`, prior `current` → `superseded`, one transaction) | awaited | no |
| `RegulatoryMetadataCommand` (correct with reason / withdraw) | awaited | no |
| `RegulatoryRetrievalPreviewCommand` | awaited | yes — one query embedding |
| `RegulatoryDocumentIngestionWorkflow` *(exists)* | background job | yes — kept for `seed_regulatory_corpus.py`; new UI doesn't use it |

Extraction libraries (agent-service only): `pypdf` (PDF text layer —
no OCR; a PDF with no extractable text fails with a clear reason),
`python-docx`, and an HTML-to-text step for fetched pages. The URL
fetch itself happens in NestJS (above), not here.

Chunking lives in `app/platform/regulatory/chunking.py` as pure
functions (text + `ChunkingConfig` → chunks), unit-tested with
fixtures, no I/O — platform-level, so a second feature's corpus reuses
it unchanged.

### Retrieval contract changes
`retrieve_regulatory_context(feature_code, query, top_k=5, typology_code=None)`:
- filters `status = 'current' AND retrieval_enabled`
- if `typology_code` is given, excludes documents whose
  `related_typology_codes` is non-empty and doesn't contain it
- orders by `similarity × retrieval_priority`
- its signature gains **no** draft-inclusion option. The Document
  view's "Test retrieval" uses a separate function,
  `preview_regulatory_retrieval(feature_code, query, top_k, include_draft_document_id)`,
  sharing the same scoring SQL but living in
  `app/platform/regulatory/preview.py`. A unit test asserts no module
  under `app/features/` imports `preview.py` — so a draft can never
  reach an agent prompt by construction, not convention.

`typology_code` is optional and defaulted, so the existing Pattern
Matching call keeps working unchanged until it's updated to pass it.
