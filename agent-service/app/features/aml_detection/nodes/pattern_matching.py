"""Node 2 — Pattern Matching Agent.
specs/suites/bfsi/features/aml-detection/agent-implementation.md

Tool allowlist: typology config lookup only — reads the active
typology catalog from aml_typology_configs (the real Typology & Rules
Console, Phase 2), via typology_config_repository.py. No external API
access."""

from __future__ import annotations

import json
from typing import ClassVar
from uuid import UUID

from app.features.aml_detection.schemas import EvidenceBundle, TypologyMatch
from app.features.aml_detection.typology_config_repository import active_catalog_as_prompt_block
from app.platform.agent_node import PlatformAgentNode
from app.platform.inference.clients import InferenceClient

AGENT_VERSION = "v1"

_SYSTEM_PROMPT = """You are the Pattern Matching Agent inside Polychoron AI's AML Detection \
workflow. You are given an evidence bundle assembled by an upstream agent, and a fixed \
catalog of typologies you may match against. Your job is only to identify whether the \
evidence matches a known typology and explain why — you never decide whether the case is \
actually suspicious, and you never recommend an action. That determination belongs to a \
later step and, ultimately, a human compliance officer.

Respond with a single JSON object with exactly these fields:
{
  "typology_code": string - one of the catalog codes below, or "no_significant_pattern" if none fit well,
  "typology_label": string - short human label for the code you chose,
  "confidence": number between 0 and 1 - your actual confidence in this match, not a recommendation,
  "matched_indicators": array of objects, each {"indicator_code": string, "indicator_description": string, "contributing_evidence": string - plain-language pointer to which evidence triggered it},
  "plain_language_rationale": string - 2-4 sentences explaining the match in plain language
}

Report your actual assessed confidence, even if low — do not inflate or deflate it to steer \
what happens next; that routing decision is made elsewhere.
"""


class PatternMatchingNode(PlatformAgentNode[EvidenceBundle, TypologyMatch]):
    agent_name = "pattern_matching"
    agent_version = AGENT_VERSION
    suite_code = "bfsi"
    feature_code = "aml_detection"
    input_schema = EvidenceBundle
    output_schema = TypologyMatch
    tool_allowlist: ClassVar[list[str]] = ["aml_typology_configs"]

    def _invoke(
        self, input: EvidenceBundle, tenant_id: str, external_case_ref: str | UUID, client: InferenceClient
    ) -> tuple[dict, list[str]]:
        evidence_json = input.model_dump(mode="json")
        prompt = (
            f"{active_catalog_as_prompt_block()}\n\n"
            f"Evidence bundle:\n{json.dumps(evidence_json, indent=2)}\n\n"
            "Respond with only the JSON object described in the system prompt."
        )

        raw_text = client.complete(prompt, system=_SYSTEM_PROMPT)
        parsed = _safe_json_parse(raw_text)

        parsed["case_id"] = str(external_case_ref)
        parsed["agent_version"] = AGENT_VERSION
        return parsed, ["aml_typology_configs"]


def _safe_json_parse(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.removeprefix("json")
    try:
        result = json.loads(text)
        return result if isinstance(result, dict) else {}
    except json.JSONDecodeError:
        # Deliberately returns a dict that will fail output_schema
        # validation, so PlatformAgentNode.run()'s retry-then-escalate
        # path handles it rather than this node improvising a fallback.
        return {}
