# Screen spec: Filing Console
**PHASE: 1 (MVP demo core)**

**Claude Design reference file:** `filing-console.*`
**Route:** `/cases/{case_id}/filing`
**RBAC (Phase 1 demo stub):** DemoRole.COMPLIANCE_OFFICER only — DemoRole.ANALYST must not reach this route (enforce server-side even in the demo stub).
**This is the highest-stakes screen on the platform — build the attestation gate first, before any visual polish.**

## Data source
`GET /api/v1/cases/{case_id}/filing-draft` → `STRFieldsDraft` + draft narrative

## Component → data binding
- Case summary header → read-only, from `Case` (typology, risk score,
  link back to Case Workspace)
- Pre-populated STR-F fields → `STRFieldsDraft`, lightly editable
  (party details, transaction details); typology tag editable via
  dropdown (officer override)
- Narrative field → agent's `draft_narrative`, editable, labeled
  "AI-drafted — review before submitting"
- Attestation panel (amber, most visually prominent element on screen):
  - Tipping-off checklist → 2-3 checkboxes, all required
  - Attestation checkbox + auto-filled officer name/role from session
- Submit button → **disabled** until
  `OfficerAttestation.can_submit == true` — re-verify server-side on
  the submit call itself, do not trust a client-side enabled state

## Interactions
- Save as draft → `POST /api/v1/cases/{case_id}/filing/attest` with
  partial data allowed, `submission_status` stays DRAFT
- Submit → `POST /api/v1/cases/{case_id}/filing/submit`; on success,
  navigate to goAML Submission Tracker for this filing

## States
- Attestation incomplete: submit button visibly disabled (not just
  functionally disabled — the visual state must be unmistakable)
- Already submitted (revisit after filing): fully read-only, show
  submission status instead of the form

## Acceptance criteria
- [ ] No code path exists that can set `submission_status = SUBMITTED`
      without `OfficerAttestation.can_submit == true` having been
      verified server-side at submit time
- [ ] `analyst_l1` role receives 403 on every endpoint this screen
      calls, not just a hidden UI element
- [ ] Override of the agent's typology tag is logged (who, what it was
      changed to, when)
