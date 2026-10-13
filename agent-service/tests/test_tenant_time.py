"""specs/platform/02-platform-data-models.py::Tenant.timezone — the agents
read evidence in the tenant's local time, so the clock times they write
match the ones officers see on screen (found 2026-09-29: narrative said
"05:00, 06:50 and 08:20", the timeline beside it said 10:00 AM onward)."""

from __future__ import annotations

import json
import uuid
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.mock_bank.seed_data import SCENARIO_A_CUSTOMER_ID, get_kyc, get_transactions
from app.features.aml_detection.nodes import pattern_matching as pattern_matching_module
from app.features.aml_detection.nodes.pattern_matching import PatternMatchingNode
from app.features.aml_detection.schemas import EvidenceBundle
from app.platform import agent_node as agent_node_module
from app.platform.guardrails.sanitize import sanitize_evidence_for_prompt
from app.platform.inference.types import InferenceProvider
from app.platform.tenant_time import UTC, localize_timestamps, tenant_timezone

KARACHI = ZoneInfo("Asia/Karachi")


def _evidence() -> EvidenceBundle:
    return EvidenceBundle(
        case_id=uuid.uuid4(),
        kyc=get_kyc(SCENARIO_A_CUSTOMER_ID),
        transaction_timeline=get_transactions(SCENARIO_A_CUSTOMER_ID),
        linked_entities=[],
        prior_cases=[],
        screening_results=[],
        agent_version="v1",
    )


def test_localize_timestamps_converts_instants_only():
    out = localize_timestamps(
        {"at": "2026-09-14T05:00:00Z", "n": [{"at": "2026-09-14T06:50:00+00:00"}], "date": "2026-09-14", "ref": "TXN-A-1001", "amount": 5},
        KARACHI,
    )
    assert out == {"at": "2026-09-14T10:00:00+05:00", "n": [{"at": "2026-09-14T11:50:00+05:00"}], "date": "2026-09-14", "ref": "TXN-A-1001", "amount": 5}


def test_prompt_shows_tenant_local_times_and_names_the_zone():
    prompt = sanitize_evidence_for_prompt(_evidence(), KARACHI)
    assert "Asia/Karachi (UTC+05:00)" in prompt
    assert "2026-09-14T10:00:00+05:00" in prompt  # Scenario A's first deposit, 05:00 UTC
    assert "05:00:00Z" not in prompt and "05:00:00+00:00" not in prompt


def test_prompt_without_zone_is_unchanged():
    prompt = sanitize_evidence_for_prompt(_evidence())
    assert prompt.startswith("<<<UNTRUSTED_EVIDENCE_DATA>>>")
    assert "2026-09-14T05:00:00" in prompt


def test_tenant_timezone_reads_the_tenant_and_falls_back_to_utc(test_tenant):
    with get_connection() as conn:
        conn.execute(text("UPDATE tenants SET timezone = 'Asia/Karachi' WHERE tenant_id = :id"), {"id": test_tenant["tenant_id"]})
        conn.commit()
    tenant_timezone.cache_clear()
    assert tenant_timezone(test_tenant["tenant_id"]) == KARACHI
    assert tenant_timezone(f"no-such-tenant-{uuid.uuid4().hex[:6]}") == UTC

    with get_connection() as conn:
        conn.execute(text("UPDATE tenants SET timezone = 'Mars/Olympus' WHERE tenant_id = :id"), {"id": test_tenant["tenant_id"]})
        conn.commit()
    tenant_timezone.cache_clear()
    assert tenant_timezone(test_tenant["tenant_id"]) == UTC
    tenant_timezone.cache_clear()


class _RecordingClient:
    provider = InferenceProvider.FOUNDATION_API

    def __init__(self) -> None:
        self.last_prompt: str | None = None

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        self.last_prompt = prompt
        return json.dumps({
            "typology_code": "structuring_subthreshold",
            "typology_label": "Structuring — sub-threshold cash deposits",
            "confidence": 0.9,
            "matched_indicators": [],
            "plain_language_rationale": "Deposits are structured to avoid the reporting threshold.",
            "cited_chunk_ids": [],
        })


def test_pattern_matching_prompt_uses_the_tenant_zone(test_tenant, monkeypatch):
    with get_connection() as conn:
        conn.execute(text("UPDATE tenants SET timezone = 'Asia/Karachi' WHERE tenant_id = :id"), {"id": test_tenant["tenant_id"]})
        conn.commit()
    tenant_timezone.cache_clear()
    client = _RecordingClient()
    monkeypatch.setattr(agent_node_module, "get_inference_client", lambda *a, **k: client)
    monkeypatch.setattr(pattern_matching_module, "retrieve_regulatory_context", lambda **kwargs: [])

    evidence = _evidence()
    PatternMatchingNode().run(evidence, test_tenant["tenant_id"], evidence.case_id)

    assert client.last_prompt is not None
    assert "2026-09-14T10:00:00+05:00" in client.last_prompt
    tenant_timezone.cache_clear()
