# Screen spec: Regulatory Knowledge Base
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** none — decided with the project owner
(2026-09-26) to build from the existing AML design system (the same
theme, tile/corner, table, and button components Typology Console and
Model Governance already use) rather than wait for a design export.
**Routes (all under `/:suiteCode/aml_detection/`):**

| Route | Screen |
|---|---|
| `regulatory-kb` | Library (list) |
| `regulatory-kb/new` | Add wizard |
| `regulatory-kb/:documentId` | Document view |
| `regulatory-kb/:documentId/edit` | Edit (metadata correction, or new draft version) |
| `regulatory-kb/:documentId/compare/:otherDocumentId` | Version compare |

**RBAC:** `aml_detection.mlro_compliance_head` only — read *and* write,
every route (manifest: "same accountability level as typology
promotion"). Any MLRO may publish; no maker-checker for now (decision
recorded in `phase-2-full-aml/api-contracts-phase2.md`, decision #4).

**Supersedes:** the Phase 2 single-page implementation (inline row
expansion + modal "Add"/"Supersede" dialogs, manual chunk entry only).
That screen is replaced, not extended — every capability it had is
kept, moved onto proper routes.

## Why this is more than a CRUD screen
Every `TypologyMatch.regulatory_citations` entry stores a `chunk_id`.
Constitution rule 8: a case must stay explainable against the text that
was actually in force when it was decided. Therefore:

- **A published chunk's text is immutable.** There is no in-place chunk
  edit anywhere in this UI or its API.
- **Content changes create a new draft version** of the document.
  Publishing the draft makes it current and supersedes the previous
  version, which stays retained and viewable forever.
- **Metadata corrections** (typo in title, updated source URL, tags) are
  allowed in place — they don't change retrievable text — but require a
  reason and write an append-only change-log row (same discipline as
  `TypologyConfigVersion`).

## Document lifecycle

```
            ┌─────────┐  publish   ┌─────────┐  newer version published  ┌────────────┐
 create ──► │  DRAFT  │ ─────────► │ CURRENT │ ────────────────────────► │ SUPERSEDED │
            └─────────┘            └─────────┘                           └────────────┘
               │  discard              │  withdraw (repealed, no replacement)
               ▼                       ▼
           (deleted —              ┌───────────┐
            never cited)           │ WITHDRAWN │
                                   └───────────┘
```

- `draft` — never returned by `retrieve_regulatory_context()`, so it
  can never be cited. The only state that may be hard-deleted
  ("Discard draft"), because nothing can reference it.
- `current` — retrievable (if `retrieval_enabled`). At most one
  `current` document per `document_family_id`.
- `superseded` — retained, not retrievable, still viewable/citable in
  historical cases.
- `withdrawn` — retained, not retrievable; for a regulation repealed
  with no replacement. Requires a reason.

## Screen 1 — Library (`regulatory-kb`)
**Data:** `GET .../regulatory-kb/documents?status=&source_type=&issuing_authority=&tag=&q=&page=&page_size=`

- Header strip: title, total count per status ("12 current · 3 drafts ·
  7 superseded"), primary **Add document** button → `regulatory-kb/new`.
- Filter bar: free-text search (title, section references, tags),
  status (default: current + draft), source type, issuing authority,
  tag. Filters are URL query params — the view is bookmarkable.
- Table columns: Title · Version · Source type · Issuing authority ·
  Effective date · Chunks · Status badge · Last changed. Paginated with
  the same rows-per-page control as Alert Queue.
- **Clicking a row navigates to `regulatory-kb/:documentId`.** No
  inline expansion.
- Status badges must be visually unmistakable (same rule as Typology
  Console's live vs. draft): `CURRENT` accent, `DRAFT` amber/dashed,
  `SUPERSEDED` / `WITHDRAWN` muted with strikethrough-free grey text
  (still legible — these are audit records, not garbage).
- A draft row whose embedding job failed shows an inline `EMBEDDING
  FAILED` marker so it's never mistaken for a publishable draft.

## Screen 2 — Add wizard (`regulatory-kb/new`)
A full-page, six-step wizard with a persistent step rail on the left.
Progress is held as a server-side **draft** from step 3 onward, so
leaving and returning (or a browser refresh) never loses work — the
draft appears in the Library with status `DRAFT`.

### Step 1 — Source
Pick one input method:

| Method | Behaviour |
|---|---|
| **Upload file** | PDF, DOCX, or TXT, max 20 MB. Original file stored (bytea, sha256) for traceability. Text extracted in agent-service. |
| **Paste full text** | Large textarea; the whole regulation pasted as-is. |
| **Fetch from URL** | Human-triggered one-off fetch of an HTML/PDF URL; the URL is also pre-filled as `source_url`. Never scheduled, never recursive (spec 10 non-negotiable #2 — no scraping). |
| **Manual chunks** | Skip extraction/chunking; author (section reference, text) pairs directly — the previous screen's only mode, kept. |

Extraction runs as a Temporal job (`RegulatoryExtractionWorkflow`); the
step shows progress and, on completion, the extracted character/page
count plus the first ~1,000 characters for a sanity check. Extraction
failure (scanned PDF with no text layer, fetch 4xx/5xx, unsupported
type) is shown with the concrete reason — OCR is out of scope.

### Step 2 — Metadata
| Field | Required | Notes |
|---|---|---|
| Title | yes | |
| Source type | yes | statute / regulation / circular / guidance / international |
| Issuing authority | yes | free text with suggestions from existing values (SBP, FMU, Government of Pakistan, FATF) |
| Version label | yes | e.g. "as amended 2024" |
| Effective date | no | when this text came into force |
| Source URL | **yes** | manifest: every citation must trace to the official publication. Pre-filled for URL fetch. |
| Jurisdiction | no | default `PK` |
| Language | no | default `en` |
| Tags | no | free-form chips |
| Related typologies | no | multi-select from `aml_typology_configs` |
| Internal notes | no | not shown to agents |
| Supersedes | no | pick an existing `current` document — this becomes its next version (same family) |

### Step 3 — Chunking configuration
Skipped for **Manual chunks**. A saved, named **chunking profile** can be
applied (e.g. "SBP Regulations — by Regulation number") or configured
ad hoc and optionally saved as a new profile.

| Setting | Options |
|---|---|
| Strategy | `heading_pattern` (split where a regex matches, e.g. `^Section \d+[A-Z]?`) · `paragraph` (blank-line boundaries) · `fixed_size` (N characters with overlap) |
| Heading pattern | regex, `heading_pattern` only — with a live "N matches found" counter |
| Target / max chunk size | characters; oversize sections are split further, with overlap |
| Overlap | characters, `fixed_size` and oversize splits only |
| Min chunk size | smaller fragments merge into the previous chunk |
| Section reference | `from_heading` (matched heading text) · `template` (e.g. `{title} ¶{n}`) |
| Strip | page headers/footers, page numbers (upload/URL only) |

**Generate preview** runs chunking (no embedding, no LLM) and moves to
step 4.

### Step 4 — Preview & adjust
The most important step — nothing is embedded until the officer is
satisfied.

- Chunk list, each showing: ordinal, section reference (editable), text
  (editable), character count, and warnings (too short / too long /
  duplicate section reference / possible injection pattern — see below).
- Per-chunk actions: edit, **merge with next**, **split at cursor**,
  delete. Plus **Add chunk** at any position.
- Totals bar: chunk count, total characters, warnings count.
- **Re-chunk** returns to step 3 with a confirm ("discards manual
  adjustments").
- **Injection scan:** every chunk is run through the existing
  `detect_injection_patterns()` (guardrail G1). Hits are flagged
  amber and must be individually acknowledged before continuing —
  uploaded/fetched documents are external text that will later sit
  near an agent prompt (constitution rule 12).

### Step 5 — Retrieval settings
| Setting | Default | Effect |
|---|---|---|
| Available to agents | on | off = stored and viewable, never retrieved |
| Retrieval priority | 1.0 | multiplier applied to similarity score (0.5–2.0) — lets binding regulation outrank guidance |
| Restrict to typologies | none (all) | if set, only retrieved when Pattern Matching is evaluating those typologies |

### Step 6 — Review & publish
Summary of every previous step. Two actions:

- **Save as draft** — chunks are embedded (so step "test retrieval"
  works on the Document view) but the document stays `draft`.
- **Publish** — embeds (if not already) then flips to `current`; if
  `supersedes` was set, the old document becomes `superseded` in the
  same transaction. Confirmation dialog states exactly what becomes
  retrievable and what gets superseded.

Embedding runs as a Temporal job with a visible progress bar
(`embedded n / N`). Publish is blocked until every chunk has an
embedding.

## Screen 3 — Document view (`regulatory-kb/:documentId`)
**Data:** `GET .../documents/:id`, `GET .../documents/:id/chunks`,
`GET .../documents/:id/versions`, `GET .../documents/:id/citations`

- **Header:** title, version label, status badge, source-publication
  link, and actions (state-dependent):
  - `current`: **Edit metadata**, **New version**, **Withdraw**,
    **Re-embed**
  - `draft`: **Continue editing**, **Publish**, **Discard draft**
  - `superseded`/`withdrawn`: read-only; link to the current version
- **Metadata panel:** every field from wizard step 2 + 5, plus
  created/published/withdrawn by & at, original file (download) if
  uploaded, chunking profile used.
- **Chunks panel:** ordered by `ordinal` (document order — *not*
  alphabetical by section reference, which the old screen did), with
  in-document search/filter and a per-chunk "cited by N cases" count.
- **Version history timeline** (whole family): each version with
  status, who published, when; **Compare** between any two.
- **Metadata change log:** append-only table — field, old → new,
  changed by, at, reason.
- **Cited by:** cases whose `regulatory_citations` reference any chunk
  of this document, linking to Case Workspace. Shows "No cases cite
  this document yet" as an explicit state.
- **Test retrieval:** query box → top-k results via the real
  `retrieve_regulatory_context()` scoring (including priority
  multiplier), highlighting which results belong to this document.
  Drafts can be tested here before publishing (a draft-inclusive
  preview mode; still never visible to agents).

## Screen 4 — Edit (`regulatory-kb/:documentId/edit`)
Two clearly separated tabs, because they have different consequences:

1. **Correct metadata** (in place): title, version label, effective
   date, source URL, jurisdiction, language, tags, related typologies,
   notes, retrieval settings. **Reason is required**; save writes one
   change-log row per changed field. Not available for `superseded`.
2. **Edit content → new version:** creates a `draft` in the same family,
   copying all chunks, then opens the wizard at step 4 (preview &
   adjust) — or step 1 if the officer wants to re-import from a new
   source file. The current version stays live until the draft is
   published.

Opening Edit on a document that already has an open draft routes to that
draft instead of creating a second one (one open draft per family).

## Screen 5 — Version compare (`.../compare/:otherDocumentId`)
Side-by-side diff of two versions in the same family: metadata diff
table + chunk-level diff (added / removed / changed, matched by
section reference, word-level highlights within changed chunks).

## States
- Loading, empty ("No documents yet — add the first one"), and error
  states on every screen; errors via the app-wide toast, never raw JSON.
- Background jobs (extraction, preview, embedding) never block
  navigation; leaving the page doesn't cancel them, and the draft shows
  the job state when revisited.
- Every timestamp on the Document view is labelled with who/when — this
  is an audit record.

## Acceptance criteria
- [ ] Clicking a Library row navigates to the Document view route; the
      route is bookmarkable and survives refresh
- [ ] No API endpoint can change the `text` of a chunk belonging to a
      `current`, `superseded`, or `withdrawn` document — tested
- [ ] Publishing a new version supersedes the old one atomically; both
      stay viewable; a historical case's citation still resolves to the
      exact text it cited
- [ ] `draft`, `superseded`, and `withdrawn` documents are never
      returned by `retrieve_regulatory_context()` — tested
- [ ] `retrieval_enabled = false` and typology restriction are honoured
      by retrieval — tested
- [ ] Metadata correction without a reason is rejected at the API and
      DB layer; every correction produces a change-log row
- [ ] All four sources work end-to-end: PDF, DOCX, TXT upload; pasted
      text; URL fetch; manual chunks
- [ ] Each chunking strategy produces a correct preview on a fixture
      document; preview never calls the embeddings API
- [ ] Injection-pattern hits in chunk text are flagged and require
      acknowledgement before publish
- [ ] Wizard progress survives a browser refresh from step 3 onward
- [ ] Non-MLRO roles get 403 on every route, read and write
- [ ] Existing Phase 1 seeded corpus migrates to `current` status with
      document-order ordinals — no regression in the two demo scenarios'
      citations
