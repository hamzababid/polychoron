# Polychoron AI — Agentic Workflow Implementation Spec

## Pattern: deterministic graph inside durable workflow
Implement as **LangGraph nodes running inside a Temporal workflow** — not
a free-roaming autonomous agent loop. The sequence Evidence → Pattern
Matching → Case/Narrative → Human Checkpoint is fixed and identical for
every case; only the content each node produces varies.

## Node contracts
Each node is a typed function: input schema in, output schema out (see
`genosai_case_models.py`). If a model's output fails schema validation,
retry once with an error-correction prompt; if it fails twice, route the
case to `Case.status = ESCALATED` and flag for manual review rather than
passing malformed data downstream.

### Node 1 — Evidence Gathering Agent
- **Input:** `InboundAlert`
- **Tool allowlist (enforced at orchestration layer, not just prompted):**
  bank core-banking read API, bank KYC read API, internal prior-case
  lookup. No write access to anything.
- **Output:** `EvidenceBundle`
- **On failure:** if an upstream API call times out or errors, retry
  with backoff (max 3 attempts); if still failing, produce a partial
  `EvidenceBundle` with a `data_sources_queried` gap noted, and flag the
  case for priority human review rather than silently proceeding with
  incomplete evidence.

### Node 2 — Pattern Matching Agent
- **Input:** `EvidenceBundle` + active typology configs (from Typology
  & Rules Console's current production versions)
- **Tool allowlist:** typology config lookup only. No external API access.
- **Output:** `TypologyMatch`

### Node 3 — Case and Narrative Agent
- **Input:** `EvidenceBundle` + `TypologyMatch`
- **Tool allowlist:** none — pure reasoning/drafting over the inputs
  already gathered.
- **Output:** `CaseAssessment` (including `STRFieldsDraft` when
  applicable)
- **Hard constraint:** this node's output schema has no field for
  "suspicion rationale" or "reportability decision" — do not add one.
  That determination is out of scope for this node by design.

### Confidence-based routing (not confidence-based decision-making)
`CaseAssessment.recommendation_confidence` determines which queue the
case lands in on Alert Queue (e.g., below a configured threshold routes
to a more senior reviewer pool), but never changes what the agent
outputs — the agent always reports its actual confidence, routing logic
lives in the workflow, not the prompt.

## Human checkpoint (Temporal signal-based pause)
After Node 3 completes, the workflow enters a **waiting state** — not a
completed-then-restarted execution — until it receives a `Disposition`
signal from the Case Workspace API. Preserve full workflow context
during the wait (this is what Temporal's durable execution gives you;
don't reimplement this with a polling job).

## Audit logging
Every node emits an `AgentActivityLogEntry` on completion — input
payload, output payload, latency, confidence, agent_version,
data_sources_queried. This is not optional or best-effort; a node that
cannot write its log entry should fail the workflow step rather than
proceed silently.

## Versioning
- Each node's prompt/config lives in the same Git repo as the workflow
  code, versioned independently (e.g. `evidence_agent@v3`).
- `AgentActivityLogEntry.agent_version` and `Case` records must persist
  which version handled them permanently — never overwrite historical
  records when a new version ships.

## Shadow mode (for promoting rule/prompt changes)
1. A proposed node version runs against live alerts in parallel with
   production, writing its output to a separate `shadow_results` table
   — never shown to an analyst, never affects `Case` state.
2. After a defined shadow period or case-volume threshold, generate a
   comparison report: agreement rate between shadow version's output
   and the actual human disposition, vs. the current production
   version's agreement rate, broken out by typology.
3. Promotion to production is a manual action via
   `POST /api/v1/typologies/{code}/promote`, gated to
   `mlro_compliance_head` role — never automatic based on shadow
   results alone.

## MLOps tracing (Layer 1 — implement first)
Emit OpenTelemetry spans for all node executions; use Langfuse (or
Arize Phoenix) specifically for the LLM call spans (prompt, completion,
token cost, latency). Link every span to `case_id` so a full case's
reasoning chain is reconstructable in one query — this is the backing
data source for the Agent Activity Log screen; do not build that screen
against a separately-maintained summary table.
