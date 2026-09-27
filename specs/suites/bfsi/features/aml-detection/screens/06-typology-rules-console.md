# Screen spec: Typology & Rules Console
**PHASE: 2 (full AML feature set)**

**Claude Design reference file:** `typology-rules-console.*`
**Routes (all under `/:suiteCode/aml_detection/`, nav label "Typology Console"):**

| Route | Screen |
|---|---|
| `typologies` | Library (list) |
| `typologies/new` | New typology |
| `typologies/:code` | Typology view |
| `typologies/:code/edit` | Edit draft + promotion |
| `typologies/:code/compare/:older/:newer` | Version compare |

Routed screens with breadcrumbs, not inline row expansion or modal
forms — same structure as the Regulatory KB (screen 11), decided with
the project owner 2026-09-26. Only confirmations (discard, promote,
kill switch) are dialogs.
**RBAC:** `mlro_compliance_head` (full: create, edit drafts, run
regression/backtest, promote, retire), `model_risk_audit` (read-only —
sees drafts, eval runs, backtests and history, but no write action is
rendered or reachable). Any MLRO may promote; no maker-checker until
Phase 3 RBAC (decision #5 in `phase-2-full-aml/api-contracts-phase2.md`,
same call as the Regulatory KB's decision #4).

## What a typology is, and why changing one is a governed act
A typology is a named money-laundering pattern — a code
(`structuring_subthreshold`), a label, and a plain-language rule
description. The Pattern Matching Agent receives the catalog of **live**
typologies as part of its prompt and decides which one (if any) an
alert's evidence matches. The rule description *is* the rule: editing
it changes what the agent detects on every alert that follows. So a
typology change is treated like a model change — drafted, evaluated,
and promoted by a named MLRO — never an in-place edit that takes
effect on save.

## Typology lifecycle (v2 — added 2026-09-26)
Supersedes the first Phase 2 build, where `POST .../typologies/{code}`
wrote straight onto the live config row (so every edit reached the
agent immediately and `promote` only moved a version number), and where
no typology could be created without a developer running a seed script.

- **Identity vs. content.** `aml_typology_configs` holds only identity:
  `typology_code` (immutable once created), `created_by`, `created_at`,
  and `production_version` (nullable — null means never promoted).
  Everything the agent sees — `typology_label`,
  `rule_logic_description`, `active` — lives on a row of
  `aml_typology_config_versions`.
- **Version states:** `draft` → `promoted` → `superseded`, or
  `draft` → `discarded`. At most one `draft` and one `promoted` version
  per typology (partial unique indexes). A non-draft version's content
  can never be updated or the row deleted (DB trigger, same pattern as
  the KB's chunk-immutability trigger). Discarding keeps the row for
  audit; it is not a delete.
- **The agent reads only the promoted version.**
  `typology_config_repository.get_active_typologies()` joins configs to
  the version at `production_version` and keeps those where that
  version's `active` is true. Drafts and never-promoted typologies are
  invisible to the production agent chain by construction.
- **Creating a typology** creates the config row (`production_version`
  null) plus version 1 as a `draft`. It is not live until promoted.
- **Editing** a live typology opens a new draft (copy of the promoted
  version's content) or edits the one already open. Drafts are editable
  in place; every save updates the draft's `changed_by`/`changed_at`
  but does not create a version.
- **Retiring** a typology = promoting a draft whose `active` is false.
  Typologies are never deleted — historic `TypologyMatch` rows and KB
  documents reference their codes. Re-activating is the same flow in
  reverse.
- **Kill switch is separate and stays immediate.** The per-typology
  kill switch (constitution rule 14, guardrail G6) is the emergency
  stop and takes effect without a draft or regression; `active` is the
  governed, versioned way to change the catalog. The detail panel shows
  both, and states which one currently excludes a typology from the
  agent.

### Promotion gate (constitution rule 15)
Real shadow mode (`agent-implementation.md`) is still not built, so the
golden-dataset regression is the gate *at promotion itself*, which is
stricter than rule 15 requires, not looser:

1. **Required — golden-dataset regression against the candidate
   catalog.** The MLRO starts a run from the draft; agent-service runs
   the full golden dataset through the real Pattern Matching (and Case
   & Narrative) nodes with the **production catalog plus this draft
   substituted in**. The run is keyed to the draft's content hash
   (`agent_version_under_test = "typology:<code>:v<version>:<hash12>"`),
   so editing the draft after a run invalidates it. Promote is refused
   (409) unless the latest run for that exact key is `passed`.
2. **Optional — historical backtest** (existing, agreement rate from
   past dispositions). Promoting without one is allowed but flagged —
   the confirm dialog says so and the promotion row keeps
   `backtest_job_id` null, as before.
3. **Coverage warning.** If no golden-dataset case has
   `expected_typology` = this code (always true for a brand-new
   typology), the regression can only prove the change doesn't disturb
   the existing typologies — the dialog says so and links to Model
   Governance's golden dataset. Allowed, not blocked.
4. **Reason required** (non-empty, DB CHECK) and stored on the
   promotion row, with `eval_run_id`, `backtest_job_id`,
   `promoted_version`, and `promoted_by` from the session.

Promotion in one transaction: the new version → `promoted`, the
previous promoted version → `superseded`, `production_version` updated,
promotion row written.

### Acting user and reasons
`changed_by`, `created_by`, `promoted_by` and `triggered_by` always
come from the session — never from the request body (same rule the KB
v2 build adopted). Create, discard and promote each take a non-empty
reason. A draft carries its own `change_reason` (what changed and why),
which must be non-empty before a regression run can start.

### Traceability
`aml_typology_matches` gains `typology_version` — the promoted version
of the matched typology that was in the agent's prompt — so any case
can be traced back to the exact rule text that produced its match.

## Data source
- `GET .../typologies` → rows with live content, draft summary (if
  any), computed metrics, kill-switch state
- `GET .../typologies/{code}` → config + promoted version + draft +
  latest eval run and backtest for the draft
- `GET .../typologies/{code}/history` → all versions incl. discarded,
  plus promotions (reason, eval run, backtest)
- `POST .../typologies` → create (code, label, description, reason)
- `POST .../typologies/{code}/draft` → open a draft from the promoted
  version (409 if one is open)
- `PATCH .../typologies/{code}/draft` → edit label / description /
  active / change_reason
- `DELETE .../typologies/{code}/draft` → discard (status change, not a delete)
- `POST .../typologies/{code}/draft/regression` → start the golden
  regression run; `GET .../typologies/regression-runs/{runId}` → status
  + `{done, total}` + per-case results when complete
- `POST .../typologies/{code}/backtest`, `GET .../typologies/backtest-jobs/{jobId}` — unchanged
- `POST .../typologies/{code}/promote` → `{backtest_job_id?, reason}`

Full request/response shapes: `phase-2-full-aml/api-contracts-phase2.md`.

## Screen 1 — Library (`typologies`)
- Header strip: live / retired / drafts open / alerts 30d counts; last
  promotion
- Feature-wide kill switch banner (guardrail G6) — unchanged
- Filters: status (live / retired / not yet live / draft open), tuning
  candidates, search; **New typology** button (MLRO only)
- Table → one row per typology: label, code, live version (or "never
  promoted"), status badge (**Live** / **Retired** / **Not yet live** /
  **Kill-switched**), "Draft vN open" marker, metrics
  (`alert_volume_30d`, `str_conversion_rate`, `false_positive_rate`)
  computed from `Case`/`Disposition` grouped by `typology_code` — never
  hand-maintained. Row click navigates to the Typology view; no inline
  expansion.

## Screen 2 — New typology (`typologies/new`)
Full-page form: code (validated `^[a-z][a-z0-9_]{2,63}$`, unique, not
`no_significant_pattern`, permanent), label, rule description, reason.
Creates the v1 draft and navigates to its Edit screen, where the
regression and promotion happen.

## Screen 3 — Typology view (`typologies/:code`)
- Header: label, code, status badge; actions by state (MLRO only):
  **Edit** (opens a draft, or continues the open one → Edit screen),
  **Disable now… / Reactivate…** (per-typology kill switch)
- Banners: draft in progress (link to Edit), not yet live, retired,
  kill-switched
- Live version tile (solid rail, read-only) + metrics
- Draft summary tile (hatched) when one is open: saved diff vs. live
  and its checklist state, linking to Edit
- Latest backtest; version history (all statuses, each with
  "Compare with live") and promotions (reason, regression run,
  backtest or a flagged "none")
- `model_risk_audit` sees all of it, with no action buttons

## Screen 4 — Edit (`typologies/:code/edit`)
- No open draft → one explicit button: "Open a draft from live vN"
  (opening a draft is a write, so never implicit)
- Draft editor (label, rule text, active, change reason), Save /
  Revert / Discard…; live version alongside for reference, and a
  word-level diff of the saved draft vs. live (the KB's `wordDiff.ts`)
- Promotion checklist: change reason saved; golden-dataset regression
  (start, `{done, total}` progress, per-case results, **stale** when
  the draft changed after the run); optional backtest; golden coverage
  warning
- **Promote…** disabled until the regression passes; confirmation
  dialog with reason and the flags above. After promote or discard →
  Typology view
- `model_risk_audit` → redirected to the Typology view

## Screen 5 — Version compare (`typologies/:code/compare/:older/:newer`)
Label, active flag and rule text of any two versions side by side with
word-level highlights; version pickers to switch either side.

## Interactions
- Toggling active/inactive is a draft change like any rule-logic edit —
  it goes through the same regression and promotion. The only
  immediate control is the kill switch.
- **Edit** on a typology with an open draft continues that draft.

## States
- **Live vs. draft must be visually unmistakable** — same principle as
  agent-vs-officer on Case Workspace. Live content: solid green rail;
  draft: hatched grey (existing styling). A never-promoted typology
  never looks live.
- Regression running / backtest running: show job status
  (queued/running/complete/failed) and progress, not a bare spinner.
- Stale regression result: explicitly labelled, promote disabled.

## Acceptance criteria
- [x] `promote` (and every other write) is unreachable by any role
      except `mlro_compliance_head`; `model_risk_audit` can read all of it
- [x] Every promotion logs which backtest job (if any) it was promoted
      from — a promotion with no linked backtest is flagged, not
      silently allowed
- [x] An MLRO can create a typology from the console; it is not in the
      agent's catalog until promoted
- [x] Saving a draft never changes what the Pattern Matching Agent
      sees — asserted by a test reading `get_active_typologies()` before
      and after a draft edit
- [x] Promote returns 409 without a passing regression run for the
      draft's current content hash, and after the draft is edited
      post-run
- [x] Promotion stores reason, eval run, backtest (nullable) and the
      session user; the previous version becomes `superseded`
- [x] Direct SQL `UPDATE` of a promoted/superseded version's content fails
- [x] Retiring (promoting `active=false`) removes the typology from the
      agent's catalog; history and old `TypologyMatch` rows are intact
- [x] Request bodies carrying `changed_by`/`promoted_by` are rejected or
      ignored — the session user is recorded
- [x] New `TypologyMatch` rows record `typology_version`
- [x] Library, New, View, Edit and Compare are separate routes with
      breadcrumbs; nothing expands inline under a table row
- [x] Both demo scenarios still match the same typology after the
      migration (catalog content unchanged by the backfill)

Walked 2026-09-28. Evidence: `app-api/test/typology-console.e2e-spec.ts`
(RBAC, create/not live, 409 without or with a stale run, reason/eval
run/backtest/session user, supersede, retire, body `*_by` ignored),
`agent-service/tests/test_typology_lifecycle.py` (draft invisible to the
agent, DB immutability, `typology_version`), the routed screens, and a
live check: Scenario A re-run matched `structuring_subthreshold` v1 with
`typology_version` recorded, and promotion was refused (409) against a
real failed regression run. The regression's success path has not been
seen live: the golden dataset passes 6/12 on the unchanged catalog (see
TASKS.md, "Agent quality").
