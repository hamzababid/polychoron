# Polychoron AI — Platform Constitution
### Non-negotiable rules that apply to every suite and every feature the platform ever hosts — not just AML Detection. Every spec, plan, and task must comply with these. If a task seems to require violating one of these, stop and flag it rather than proceeding.

A feature may add its own additional, stricter rules in its own
constitution addendum (see e.g.
`suites/bfsi/features/aml-detection/constitution-addendum.md`), but may
never relax anything stated here.

## 1. The agent assembles; the human decides
No feature may ship a code path that takes a consequential, irreversible,
or regulated action (a regulatory filing, a fund freeze, an account
closure — whatever that means in that feature's domain) without a
completed, named human attestation. Each feature defines its own
attestation object (AML's is `OfficerAttestation.can_submit`), but every
such gate must be re-checked server-side at the moment of action —
never trust client-side state alone.

## 2. Agent content vs. human content is always visually and structurally distinct
Anywhere agent-drafted text and human-written text appear together, they must:
- live in separate data fields (never concatenated into one string)
- render with visually distinct styling (background, label, or both)
- never allow an agent edit to silently overwrite a human's note

## 3. Every agent action is audited
Every agent node invocation, in every feature, writes an immutable
`PlatformAgentActivityLogEntry` (see
`platform/02-platform-data-models.py`) — input, output, latency,
confidence, agent version, data sources queried, tagged with
`suite_code`/`feature_code`. A workflow step that cannot write its log
entry must fail the step, not proceed silently.

## 4. Overrides require reasons, enforced at the data layer
Whenever a human's decision differs from an agent's recommendation, the
feature's disposition model must require a reason field before
accepting the override. This is a model-level constraint, not just a
UI validation — see AML's `Disposition.override_reason` as the
reference implementation.

## 5. Confidence changes routing, not conclusions
An agent's confidence score changes which review queue a case enters or
whether it's escalated — it never changes what the agent reports. The
agent always states its actual assessment; a human or a fixed threshold
decides what to do about low confidence.

## 6. Deterministic agent orchestration, not free-form autonomy
Every feature's agent chain runs as a fixed, known sequence of nodes,
every time — implemented as a graph (e.g. LangGraph) inside a durable
workflow engine (e.g. Temporal), never as a single agent freely deciding
which tools to call and when. See `platform/03-agent-framework-spec.md`.

## 7. Confidentiality is structural, not just policy
No customer-facing surface may ever reference an open case or filing
from any feature. Role boundaries (see
`platform/05-rbac-platform-spec.md`) must be enforced server-side on
every endpoint — a hidden UI element is not access control.

## 8. Versioning is mandatory for anything that affects live decisions
Every agent prompt/config version and every feature-specific rule
version is tracked. A case record permanently stores which version
handled it — never overwritten by a later version shipping.

## 9. Phase discipline
A feature's Phase 1 code must not silently grow into its Phase 2/3
scope (e.g., don't build full SSO "while you're in there" during a
Phase 1 auth task — stub it per the phase spec, note the shortcut, move
on). Likewise, building a second feature or suite must not require
rewriting platform-level code — if it does, treat that as a bug in the
platform architecture, not a reason to special-case the new feature.

## 10. Demo-data honesty
All seed/demo data used for any demo, in any feature, must be clearly
fictional and must never resemble a real individual, real national ID,
or real account-number pattern closely enough to cause confusion in a
screenshot or live demo.

## 11. Inference provider selection is routed, never hardcoded
No agent node may instantiate an LLM SDK client directly or hardcode
which provider (self-hosted vs. foundation API) it uses. Every node
calls the platform's model inference router
(`platform/08-model-inference-routing-spec.md`), which resolves the
provider per-tenant, per-feature, and optionally per-node from an
explicit, validated `TenantInferenceProfile` — and fails closed (refuses
to run) rather than guessing when that profile is missing or
inconsistent. Which provider served a call is an audited fact on every
log entry, not an assumption.

## 12. Untrusted evidence text is always data, never instructions
Any free-text field that reaches an agent's prompt from an external
system (transaction narration, counterparty names, memo fields) must be
wrapped in explicit data delimiters and scanned for injection patterns
before use. A match is flagged for human review, never silently
executed as an instruction. See
`platform/11-evals-and-guardrails-framework.md`, guardrail G1.

## 13. Regulatory citations are verified before they're trusted
An agent may never persist or display a regulatory citation whose
source chunk wasn't actually present in that call's retrieval result.
Fabricated citations are stripped and logged as a guardrail violation —
never silently accepted because they look plausible. See guardrail G3.

## 14. A kill switch must exist, scoped to typology and to feature
Every feature must provide a senior-role-only control to disable a
specific detection typology, or the feature's entire agent chain, per
tenant — checked before any typology-specific reasoning runs. A
disabled case is routed to full manual review and marked as such in its
own record, never silently processed as if nothing had changed. See
guardrail G6.

## 15. No agent version proceeds to shadow mode without passing golden-dataset regression
Every feature must maintain a golden-dataset regression suite. A
proposed agent/prompt/rule version that fails this suite must not enter
shadow-mode comparison, let alone be promoted to production. See
`platform/11-evals-and-guardrails-framework.md`, eval E1.

## 16. Fairness monitoring is continuous, not a one-time check
Any feature whose output affects how individuals or entities are
treated must run continuous, segment-level fairness monitoring, with
defined dimensions and a human-reviewed alert path when deviation
exceeds threshold. Monitoring may only flag for human review — it must
never trigger an automatic corrective action on its own. See eval E5.
