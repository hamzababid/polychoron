# Polychoron AI — Backend Service Boundary Spec
### Platform-level. Two backend services, split along the human/agent line already implicit in the constitution — not two arbitrarily divided halves of one app.

## The two services

| Service | Language/framework | Owns |
|---|---|---|
| **Application API** | NestJS (TypeScript) | Every screen-facing endpoint, RBAC guards, disposition/filing business logic, platform auth (Phase 3 OIDC/SAML), tenant/role management |
| **Agent Orchestration Service** | FastAPI (Python) | LangGraph node implementations, Temporal workflow *definitions* and worker processes, the model inference router, all direct LLM calls |

This mirrors the constitution's own human/agent split (rule 1, rule 2):
NestJS is the human-facing half, Python is the agent-facing half. Neither
service reaches into the other's responsibility — NestJS never calls an
LLM directly; the Python service never serves a screen-facing endpoint
or enforces RBAC.

## The cross-language mechanism: Temporal client vs. Temporal worker
This is the detail that makes the split actually work, not just look
clean on paper.

- **Temporal workflows are defined and executed by Python code** — the
  LangGraph-based agent chain runs on a **Python Temporal worker**.
  This is fixed; it cannot run anywhere else.
- **Starting, signaling, and querying a workflow are separate concerns
  from running one.** Temporal's TypeScript SDK gives NestJS a full
  client for all three, without NestJS needing to run a worker or know
  anything about LangGraph.

Concretely:
- **Alert ingestion**: NestJS receives the bank's TMS webhook, writes
  the `Case` row, then calls Temporal's TS client to **start** the
  Python-defined workflow. No direct HTTP call from NestJS to the
  Python service for this.
- **Human checkpoint resume**: when an officer records a `Disposition`
  in Case Workspace, NestJS's disposition endpoint calls Temporal's TS
  client to **send a signal** to the paused workflow. The Python worker,
  still holding that workflow's state, wakes up and continues. Again,
  no direct NestJS→Python HTTP call.
- **Status/progress queries**: if a screen needs live workflow status
  beyond what's in Postgres, NestJS can issue a Temporal **query** via
  the same TS client.

**NestJS and the Python service never call each other directly over
HTTP for the agent-chain lifecycle.** Temporal is the only integration
surface between them for this. This is the same "human checkpoint is a
workflow pause on a signal, not a completed-then-restarted execution"
principle from the agent framework spec — it turns out to hold up
cleanly across a language boundary for free, which is why this split
doesn't cost you the framework's original guarantees.

## Data layer: shared Postgres, table-level ownership
One database, for MVP simplicity — not a stricter per-service database
split, which would add real complexity with no benefit at this stage.

| Owned by NestJS (writes) | Owned by Python service (writes) |
|---|---|
| `Case` (status, assignment fields) | `EvidenceBundle` |
| `Disposition` | `TypologyMatch` |
| `STRFiling` | `CaseAssessment` |
| `PlatformUser`, `PlatformRole`, `Tenant` | `PlatformAgentActivityLogEntry` |
| | `TenantInferenceProfile` |

Both services read freely across this line (e.g. NestJS's Alert Queue
endpoint reads `CaseAssessment` rows the Python service wrote). Only
writes are exclusive per table — if both services ever need to write
the same table, that's a signal the ownership split needs revisiting,
not a reason to add locking workarounds.

## What this changes about Kafka's role
Temporal itself now handles workflow-triggering and signaling — the use
case Kafka was originally slotted for in Phase 1. **Kafka is deferred to
Phase 2**, where it earns its place for genuine fan-out (one
case-outcome event feeding Model Governance & Audit, Typology retuning,
and Reporting simultaneously) rather than being built as Phase 1
infrastructure that isn't yet load-bearing.

## Repo/deployment structure
Two deployable services, two codebases (can be one monorepo with two
top-level directories, e.g. `app-api/` and `agent-service/`, or two
repos — either works; pick based on your team's existing tooling
preference, this spec doesn't mandate one).

- `app-api/` — NestJS, modules organized to mirror the Suite → Feature
  hierarchy (one Nest module per feature, e.g. an `AmlDetectionModule`)
- `agent-service/` — FastAPI, with the LangGraph node implementations
  organized per feature the same way (e.g.
  `agent-service/features/aml_detection/`)

## What does NOT change
- The model inference router (`platform/08-model-inference-routing-spec.md`)
  lives entirely inside the Python service — NestJS never needs it,
  since it never calls an LLM.
- The constitution's non-negotiables apply identically regardless of
  which service is executing — rule 3 (audit every agent action), rule
  4 (overrides require reasons), rule 7 (confidentiality/RBAC), etc. are
  all still enforced at the same points, just now split by which
  service owns that point.
- `platform/06-adding-a-new-feature-guide.md`'s checklist is unchanged
  in shape — a new feature adds a Nest module to `app-api/` and a
  Python feature package to `agent-service/`, following the same
  pattern AML Detection establishes.
