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

Guardrail G2 (specs/platform/11-evals-and-guardrails-framework.md):
transaction_timeline/linked_entities/prior_cases degrade to an empty
list with a noted gap on failure rather than failing the whole case —
this closes the "Known Phase 1 simplification" gap this module used to
document. KYC has no reasonable empty default (KYCSnapshot's fields are
required, and a case can't be meaningfully evaluated without it), so a
KYC failure still fails the activity outright, same as before."""

from __future__ import annotations

from typing import ClassVar
from uuid import UUID

import httpx

from app.config import settings
from app.features.aml_detection.prior_cases import get_prior_cases
from app.features.aml_detection.schemas import EvidenceBundle, InboundAlert
from app.platform.agent_node import PlatformAgentNode
from app.platform.inference.clients import InferenceClient
from app.platform.logging import get_correlation_id

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
        data_gaps: list[str] = []
        base_url = settings.mock_bank_base_url
        correlation_id = get_correlation_id()
        headers = {"x-correlation-id": correlation_id} if correlation_id else {}

        with httpx.Client(base_url=base_url, timeout=10.0, headers=headers) as http:
            # KYC has no meaningful empty default — every field on
            # KYCSnapshot is required, so a failure here still fails
            # the activity (Temporal's own retry policy, see
            # workflows.py, is what covers transient failures).
            kyc_resp = http.get(f"/mock-bank/kyc/{input.customer_id}")
            kyc_resp.raise_for_status()
            data_sources_queried.append("mock_bank.kyc")

            transaction_timeline: list = []
            try:
                txn_resp = http.get(f"/mock-bank/transactions/{input.customer_id}", params={"days_back": 30})
                txn_resp.raise_for_status()
                transaction_timeline = txn_resp.json()
                data_sources_queried.append("mock_bank.transactions")
            except httpx.HTTPError as exc:
                data_gaps.append(f"mock_bank.transactions unavailable after retry: {exc}")

            linked_entities: list = []
            try:
                linked_resp = http.get(f"/mock-bank/linked-entities/{input.customer_id}")
                linked_resp.raise_for_status()
                linked_entities = linked_resp.json()
                data_sources_queried.append("mock_bank.linked_entities")
            except httpx.HTTPError as exc:
                data_gaps.append(f"mock_bank.linked_entities unavailable after retry: {exc}")

        try:
            prior_cases = [pc.model_dump(mode="json") for pc in get_prior_cases(input.customer_id, external_case_ref)]
            data_sources_queried.append("internal.prior_cases")
        except Exception as exc:  # noqa: BLE001 — degrade, don't fail the case, over an internal lookup
            prior_cases = []
            data_gaps.append(f"internal.prior_cases unavailable: {exc}")

        bundle = {
            "case_id": str(external_case_ref),
            "kyc": kyc_resp.json(),
            "transaction_timeline": transaction_timeline,
            "linked_entities": linked_entities,
            "prior_cases": prior_cases,
            "screening_results": [],
            "agent_version": AGENT_VERSION,
            "data_gaps": data_gaps,
        }
        return bundle, data_sources_queried
