"""Node 3 — Case and Narrative Agent.
specs/suites/bfsi/features/aml-detection/agent-implementation.md

Tool allowlist: none — pure reasoning/drafting over inputs already
gathered. Hard constraint (constitution-addendum A1): this node's
output schema has no field for "suspicion rationale" or a
reportability decision — CaseAssessment/STRFieldsDraft structurally
don't have one, so there is no slot for the model to fill in even if
prompted to.

STRFieldsDraft's fields are "structured, factual, agent-fillable
fields" that are already present verbatim in the evidence bundle
(CNIC, address, occupation, account/transaction refs, totals) — this
node fills them deterministically in code rather than asking the LLM
to retype them, which removes an unnecessary transcription-hallucination
risk on fields that end up on a regulatory filing. The LLM is only
asked for the actual judgment: risk_score, recommendation,
recommendation_confidence, and the factual narrative.
"""

from __future__ import annotations

import json
from typing import ClassVar
from uuid import UUID

from app.features.aml_detection.schemas import (
    AgentRecommendation,
    CaseAssessment,
    CaseNarrativeInput,
    STRFieldsDraft,
)
from app.platform.agent_node import PlatformAgentNode
from app.platform.inference.clients import InferenceClient

AGENT_VERSION = "v1"

# Phase 1 has exactly one demo tenant/bank — see
# specs/platform/02-platform-data-models.py::Tenant and
# mvp-phases.md (multi-tenancy is Phase 3 scope).
DEMO_REPORTING_ENTITY_CODE = "PK-DEMO-BANK-001"

_SYSTEM_PROMPT = """You are the Case and Narrative Agent inside Polychoron AI's AML Detection \
workflow, the final agent step before a human compliance officer reviews the case. You are \
given an evidence bundle and a typology match from upstream agents.

You do NOT make the legal suspicion determination — that is reserved for a human compliance \
officer. Your job is to: (1) score risk, (2) recommend a next step for triage routing only, \
and (3) draft a strictly factual narrative reconstruction of what the evidence shows. Do not \
write "this is suspicious because..." reasoning — describe only what happened, factually. \
Your recommendation is used to route the case to the right review queue; it is never treated \
as the final answer, so report your genuine assessment, including genuine uncertainty.

Use this guidance for "recommendation" (a routing signal, not a verdict):
- "recommend_str": the typology match is high-confidence AND the pattern has no plausible
  innocent explanation on the evidence available (e.g. deliberate threshold avoidance,
  amounts far outside the customer's declared profile, corroborating red flags like a
  linked entity). Use this when the evidence is clear-cut, even though a human still decides.
- "escalate": evidence is concerning but genuinely ambiguous, has a plausible business
  explanation you can't rule out, or the typology match confidence is only moderate —
  send it to a senior reviewer rather than guessing.
- "clear": no significant indicators, or a strong plausible explanation with a clean history.
- "recommend_ctr": a large transaction requires routine currency-transaction reporting with
  no suspicion indicators at all.

Respond with a single JSON object with exactly these fields:
{
  "risk_score": integer 0-100,
  "recommendation": one of "clear", "escalate", "recommend_str", "recommend_ctr",
  "recommendation_confidence": number between 0 and 1 - your actual confidence, not inflated or deflated,
  "draft_narrative": string - 3-6 sentences, factual reconstruction only, no suspicion claims
}
"""


class CaseNarrativeNode(PlatformAgentNode[CaseNarrativeInput, CaseAssessment]):
    agent_name = "case_narrative"
    agent_version = AGENT_VERSION
    suite_code = "bfsi"
    feature_code = "aml_detection"
    input_schema = CaseNarrativeInput
    output_schema = CaseAssessment
    tool_allowlist: ClassVar[list[str]] = []

    def _invoke(
        self, input: CaseNarrativeInput, tenant_id: str, external_case_ref: str | UUID, client: InferenceClient
    ) -> tuple[dict, list[str]]:
        prompt = (
            f"Evidence bundle:\n{json.dumps(input.evidence.model_dump(mode='json'), indent=2)}\n\n"
            f"Typology match:\n{json.dumps(input.typology_match.model_dump(mode='json'), indent=2)}\n\n"
            "Respond with only the JSON object described in the system prompt."
        )

        raw_text = client.complete(prompt, system=_SYSTEM_PROMPT)
        judgment = _safe_json_parse(raw_text)

        result: dict = {
            "case_id": str(external_case_ref),
            "agent_version": AGENT_VERSION,
            **judgment,
        }

        recommendation = judgment.get("recommendation")
        if recommendation in (AgentRecommendation.RECOMMEND_STR.value, AgentRecommendation.RECOMMEND_CTR.value):
            result["str_fields_draft"] = self._build_str_fields_draft(input).model_dump(mode="json")

        return result, []

    def _build_str_fields_draft(self, input: CaseNarrativeInput) -> STRFieldsDraft:
        evidence = input.evidence
        total_amount = sum(t.amount for t in evidence.transaction_timeline)

        return STRFieldsDraft(
            party_name=evidence.kyc.customer_name,
            party_cnic=evidence.kyc.cnic,
            party_address=evidence.kyc.address,
            party_occupation=evidence.kyc.declared_occupation,
            account_ids=input.account_ids,
            transaction_refs=[t.txn_ref for t in evidence.transaction_timeline],
            total_amount=total_amount,
            typology_tag=input.typology_match.typology_code,
            reporting_entity=DEMO_REPORTING_ENTITY_CODE,
        )


def _safe_json_parse(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.removeprefix("json")
    try:
        result = json.loads(text)
        return result if isinstance(result, dict) else {}
    except json.JSONDecodeError:
        return {}
