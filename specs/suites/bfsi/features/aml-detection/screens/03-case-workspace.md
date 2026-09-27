# Screen spec: Case Workspace
**PHASE: 1 (MVP demo core)**

**Claude Design reference file:** `case-workspace.*`
**Route:** `/cases/{case_id}`
**RBAC (Phase 1 demo stub):** DemoRole.ANALYST can investigate/disposition up to escalate; DemoRole.COMPLIANCE_OFFICER can additionally file. Full granular roles are Phase 3.
**This is the highest-usage screen on the platform — prioritize this build.**

## Data source
`GET /api/v1/cases/{case_id}` → full `Case` object
`GET /api/v1/cases/{case_id}/activity-log` → for the "why" expansions

## Component → data binding — left panel (evidence, agent-assembled, read-only)
- Customer summary strip → `Case.evidence.kyc`
- Transaction timeline → `Case.evidence.transaction_timeline`
- Linked-entity graph → `Case.evidence.linked_entities` (render as
  node/edge graph — reuse same graph component on Customer 360)
- Prior alerts panel → `Case.evidence.prior_cases`
- Screening results → `Case.evidence.screening_results`

## Component → data binding — right panel (mixed agent + human)
- Typology block, labeled "AI-drafted" → `Case.typology_match`
  (`typology_label`, `plain_language_rationale`, `matched_indicators`)
- Editable agent narrative → `Case.assessment.draft_narrative`, editable
  text area, **visually distinct background from officer notes**
- Officer notes field → separate free-text field, not the same DB
  column as the agent narrative — never overwritten by agent edits, even
  on case re-processing
- Disposition button row → maps to `DispositionType` enum
- Override reason field → appears conditionally, only when the selected
  disposition differs from `Case.assessment.recommendation`; required
  before submit is enabled (mirrors the server-side model constraint —
  do not rely on server validation alone, this must be a real UX gate)

- Regulatory citations (added 2026-09-27 — they were stored but never
  shown) → `TypologyMatch.regulatory_citations`, enriched server-side
  with each chunk's document id/status and passage text: document
  title, section reference, relevance, the passage itself, and — for
  `mlro_compliance_head`, who can open the KB — a link to the document.
  Labelled AI-cited supporting context, never a determination
  (constitution-addendum A5).

## Interactions
- Disposition submit → `POST /api/v1/cases/{case_id}/disposition`
- If disposition is `file_str`/`file_ctr` → navigate to Filing Console
  on success

## States
- **Agent state** (added 2026-09-27 — a seeded pre-system case showed
  "processing…" forever): a case without a risk score shows why, from
  app-api's `agent-state.ts` — *processing* (activity within 15 min),
  *agent didn't finish* (started, no assessment — review manually),
  *manual review (kill switch)*, or *no agent record* (closed without
  the agent ever running, e.g. decided before AML Detection existed).
  Never "processing" for a case that can't still be processed.
- Partial evidence (Evidence Agent flagged a data-source gap) → show a
  visible warning banner, do not silently present incomplete evidence
  as complete — listing each `EvidenceBundle.data_gaps` entry (built
  2026-09-27; until then only the Alert Queue showed the flag)
- Case already disposed (read-only view for closed cases) → all
  editable fields render as read-only, disposition history shown instead
  of the action row

## Acceptance criteria
- [ ] Agent-authored and human-authored text are never rendered in the
      same visual style (background, label, or both must differ)
- [ ] It is impossible to submit an override without a reason (client
      **and** server enforced)
- [ ] Linked-entity graph reuses the same component/data shape as
      Customer 360's graph — do not build two implementations
