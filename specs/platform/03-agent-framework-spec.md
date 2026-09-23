# Polychoron AI — Platform Agent Framework
### This is the reusable pattern. Each feature (starting with AML Detection) implements against this contract — it does not invent its own orchestration approach.

## The pattern: deterministic graph inside a durable workflow
Every feature's agent chain is built as **LangGraph nodes running inside
a Temporal workflow**. This is a platform-level architectural decision,
not an AML-specific one — the reasoning (auditability, narrow failure
modes, matching the point where legal/business judgment must stay
human) applies to any agentic use case the platform will ever host.

## The base node contract every feature must implement

```python
class PlatformAgentNode(Protocol):
    """Every feature's agent nodes implement this shape."""
    agent_name: str        # unique within the feature, e.g. "evidence_gathering"
    agent_version: str     # e.g. "v3" — versioned independently per node
    input_schema: type[BaseModel]
    output_schema: type[BaseModel]
    tool_allowlist: list[str]   # explicit, enforced at the orchestration
                                # layer — not just prompted

    def run(self, input: BaseModel, tenant_id: str) -> BaseModel:
        """Must call get_inference_client(tenant_id, feature_code,
        self.agent_name) from the platform's model inference router
        (platform/08-model-inference-routing-spec.md) to obtain its LLM
        client — NEVER instantiate an LLM SDK client directly inside a
        node. This is what makes self-hosted-vs-foundation-API a
        per-tenant, per-feature, even per-node configuration decision
        rather than something baked into the node's code.

        Must validate output against output_schema before returning.
        On validation failure: retry once, then escalate to human review
        rather than passing malformed data downstream."""
        ...
```

## Non-negotiable behaviors every feature's implementation must have
(These restate constitution rules 3–6 and 11–14 at the framework level
— see `platform/00-constitution.md` for the source of truth, and
`platform/11-evals-and-guardrails-framework.md` for the full guardrail
mechanisms referenced below.)

1. Every node invocation writes a `PlatformAgentActivityLogEntry`
   (platform data model) — tagged with `suite_code`/`feature_code` so
   the log is queryable across features later.
2. A human checkpoint is a **workflow pause on a Temporal signal**, not
   a completed-then-restarted execution.
3. Confidence scores drive **routing** (which queue/reviewer pool a
   case lands in, per a `ConfidenceRoutingPolicy`), never the agent's
   own conclusion.
4. Every node's prompt/config is versioned in the same repo as the
   workflow code; case records permanently store which version handled
   them.
5. Promotion of a new node version to production requires **passing
   golden-dataset regression, then** a shadow-mode comparison period,
   then an explicit human promotion action — never automatic, and never
   skipping the golden-dataset gate.
6. Before any typology-specific reasoning runs, the Pattern Matching
   node checks `is_typology_active()` (the kill switch, guardrail G6) —
   a disabled typology or feature routes straight to manual review.
7. Any free-text evidence field entering a prompt is sanitized and
   scanned per guardrail G1 before use.
8. Any regulatory citation an agent produces is validated against the
   actual retrieval result per guardrail G3 before being persisted.

## How a feature registers its agent chain
A feature (e.g. AML Detection) defines:
- Its own concrete node implementations (Evidence Gathering, Pattern
  Matching, Case & Narrative — see
  `suites/bfsi/features/aml-detection/agent-implementation.md`)
- Its own Temporal workflow definition wiring those nodes together in
  the feature's specific sequence
- A registration call at startup that tells the platform's workflow
  registry "this feature's workflow exists, triggered by this event
  type" — so the platform can route an inbound event
  (e.g. `POST /api/v1/features/aml_detection/alerts/ingest`) to the
  correct feature's workflow without the platform needing to know
  anything about AML specifically

## What this buys you when a second feature is added later
A hypothetical second feature (e.g. a future Fraud Detection feature)
would:
1. Define its own node implementations against the same
   `PlatformAgentNode` contract
2. Define its own Temporal workflow
3. Register its own trigger endpoint and role manifest
4. Automatically get audit logging, versioning, and shadow-mode
   promotion "for free" from the platform framework — none of that is
   rebuilt per feature

This is the concrete test of whether the platform architecture is
actually extensible: if adding a second feature ever requires changing
platform-level code (not just adding feature-level code), the
abstraction has leaked and should be revisited.
