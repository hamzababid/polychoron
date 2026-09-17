"""Node 1 — Evidence Gathering Agent.
specs/suites/bfsi/features/aml-detection/agent-implementation.md

Tool allowlist: bank core-banking read API, bank KYC read API, internal
prior-case lookup — no write access to anything. This node is
deliberately deterministic tool-calling/assembly rather than
LLM-driven generation (its output, EvidenceBundle, is structured facts,
not prose) — it still resolves an inference client via the router
(constitution rule 11 — no node hardcodes/skips the router), it simply
has no need to call .complete() on it. Screening (Sanctions & PEP Hub)
is Phase 2 scope, so screening_results is empty here, not stubbed with
fabricated matches.
"""

from __future__ import annotations

from typing import ClassVar
from uuid import UUID

import httpx

from app.config import settings
from app.features.aml_detection.prior_cases import get_prior_cases
from app.features.aml_detection.schemas import EvidenceBundle, InboundAlert
from app.platform.agent_node import PlatformAgentNode
from app.platform.inference.clients import InferenceClient

AGENT_VERSION = "v1"


class EvidenceGatheringNode(PlatformAgentNode[InboundAlert, EvidenceBundle]):
    agent_name = "evidence_gathering"
    agent_version = AGENT_VERSION
    suite_code = "bfsi"
    feature_code = "aml_detection"
    input_schema = InboundAlert
    output_schema = EvidenceBundle
    tool_allowlist: ClassVar[list[str]] = [
        "mock_bank.kyc",
        "mock_bank.transactions",
        "mock_bank.linked_entities",
        "internal.prior_cases",
    ]

    def _invoke(
        self, input: InboundAlert, tenant_id: str, external_case_ref: str | UUID, client: InferenceClient
    ) -> tuple[dict, list[str]]:
        data_sources_queried: list[str] = []
        base_url = settings.mock_bank_base_url

        with httpx.Client(base_url=base_url, timeout=10.0) as http:
            kyc_resp = http.get(f"/mock-bank/kyc/{input.customer_id}")
            kyc_resp.raise_for_status()
            data_sources_queried.append("mock_bank.kyc")

            txn_resp = http.get(f"/mock-bank/transactions/{input.customer_id}", params={"days_back": 30})
            txn_resp.raise_for_status()
            data_sources_queried.append("mock_bank.transactions")

            linked_resp = http.get(f"/mock-bank/linked-entities/{input.customer_id}")
            linked_resp.raise_for_status()
            data_sources_queried.append("mock_bank.linked_entities")

        prior_cases = get_prior_cases(input.customer_id, external_case_ref)
        data_sources_queried.append("internal.prior_cases")

        bundle = {
            "case_id": str(external_case_ref),
            "kyc": kyc_resp.json(),
            "transaction_timeline": txn_resp.json(),
            "linked_entities": linked_resp.json(),
            "prior_cases": [pc.model_dump(mode="json") for pc in prior_cases],
            "screening_results": [],
            "agent_version": AGENT_VERSION,
        }
        return bundle, data_sources_queried
