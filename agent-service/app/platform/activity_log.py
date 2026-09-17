"""Writes to platform_agent_activity_log — the single immutable audit
trail every agent node invocation must write to (constitution rule 3).
A write failure here must fail the calling workflow step, not be
swallowed — callers should let exceptions from write_activity_log
propagate."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text

from app.db import get_connection

_INSERT_SQL = text(
    """
    INSERT INTO platform_agent_activity_log (
        tenant_id, suite_code, feature_code, external_case_ref,
        agent_name, agent_version, model_provider,
        input_payload, output_payload, confidence, latency_ms,
        data_sources_queried, "timestamp"
    ) VALUES (
        :tenant_id, :suite_code, :feature_code, :external_case_ref,
        :agent_name, :agent_version, :model_provider,
        cast(:input_payload as jsonb), cast(:output_payload as jsonb),
        :confidence, :latency_ms,
        :data_sources_queried, :timestamp
    )
    RETURNING log_id
    """
)


def write_activity_log(
    *,
    tenant_id: str,
    suite_code: str,
    feature_code: str,
    external_case_ref: str | UUID,
    agent_name: str,
    agent_version: str,
    model_provider: str,
    input_payload: dict[str, Any],
    output_payload: dict[str, Any],
    confidence: float | None,
    latency_ms: int,
    data_sources_queried: list[str],
) -> UUID:
    with get_connection() as conn:
        result = conn.execute(
            _INSERT_SQL,
            {
                "tenant_id": tenant_id,
                "suite_code": suite_code,
                "feature_code": feature_code,
                "external_case_ref": str(external_case_ref),
                "agent_name": agent_name,
                "agent_version": agent_version,
                "model_provider": model_provider,
                "input_payload": json.dumps(input_payload, default=str),
                "output_payload": json.dumps(output_payload, default=str),
                "confidence": confidence,
                "latency_ms": latency_ms,
                "data_sources_queried": data_sources_queried,
                "timestamp": datetime.now(UTC),
            },
        )
        log_id = result.scalar_one()
        conn.commit()
        return log_id
