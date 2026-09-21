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
