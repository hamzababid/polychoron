# AML Detection — Regulatory Corpus Manifest
### The documents this feature's Regulatory Knowledge Base is seeded with. See `platform/10-regulatory-knowledge-base-spec.md` for the retrieval mechanism.

## Phase 1 (demo) — minimal hand-seeded set
Enough chunks to make citation visibly work for the two seed scenarios,
not a complete corpus:
- **AMLA 2010** — Section 7 (CTR threshold), Section 7A (CDD
  requirements), Section 34 (confidentiality/tipping-off) — 3-5 chunks
- **FMU Red Flags for Banks** — the structuring category and the
  high-velocity/account-behavior category specifically (matches the two
  Phase 1 seed scenarios) — 5-10 chunks

## Phase 2 (full corpus) — build the real ingestion pipeline for these
- Full text of AMLA 2010
- Current SBP AML/CFT/CPF Regulations (all sections, current
  consolidated version)
- FMU's complete red-flag indicator set (all categories: no-economic-
  sense, inconsistent-with-business, high-value-cash, structuring,
  account-behavior, cross-border, customer-profile-mismatch)
- Relevant SBP circulars amending the above, with `superseded_by`
  chains maintained as amendments are issued

## Ownership and update process
- **Who can add/supersede a document**: `aml_detection.mlro_compliance_head`
  role only (same accountability level as typology promotion)
- **Trigger for updates**: SBP issues a new circular or amends the
  AML/CFT/CPF Regulations — a human (compliance function) reviews it,
  decides what changes for the corpus, and ingests the update; this is
  explicitly not automated (see constitution/spec note on scope — no
  auto-scraping SBP's website)
- **How an update is made** (Phase 2, see
  `screens/11-regulatory-knowledge-base.md`): the officer opens the
  current document → Edit → "Edit content" (or starts a new document
  with *Supersedes* set), which creates a **draft** version. The draft
  is chunked, reviewed, embedded, and test-retrieved without ever being
  visible to agents; **Publish** makes it current and supersedes the
  old version in one step. The old version is retained forever. A
  repealed regulation with no replacement is **Withdrawn**, not deleted.
  Typos in metadata are corrected in place with a recorded reason.
- **Source format**: PDF/text extraction of the official published
  regulation/circular — retain a `source_url` pointing to the official
  SBP/FMU publication for every document, so a citation can always be
  traced back to the authoritative source, not just the chunked text
  stored in Polychoron AI. Accepted inputs: PDF (text layer only — no
  OCR), DOCX, TXT upload; pasted text; a single human-triggered fetch
  of the official URL; or manual section-by-section entry. The
  original uploaded/fetched file is retained alongside the chunks.
- **Recommended chunking profiles** (saved in the app, reusable):
  AMLA 2010 — heading pattern `^\d+[A-Z]?\.\s` (section numbers);
  SBP AML/CFT/CPF Regulations — heading pattern on regulation numbers;
  FMU red flags — one chunk per indicator (heading pattern on the
  indicator bullet/number). Adjust in preview before publishing.
