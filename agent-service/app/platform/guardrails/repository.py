"""DB access for the guardrails mechanisms in
specs/platform/11-evals-and-guardrails-framework.md. Writes to
platform_guardrail_violations/platform_kill_switch_scopes go through
here from agent-service's side; platform_kill_switch_scopes rows
themselves are created/reactivated by app-api's kill-switch endpoint
(mlro_compliance_head-only action) — agent-service only reads them,
same read/write split as aml_typology_configs."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text

from app.db import get_connection
from app.platform.guardrails.types import GuardrailSeverity, GuardrailType

# Fallback used when no ConfidenceRoutingPolicy row exists for a given
# tenant/feature/typology — Phase 1 ships the table (TASKS.md's
# "Add ... ConfidenceRoutingPolicy ... tables" bullet) without a CRUD
# screen yet, so a sane platform default keeps routing meaningful
# rather than undefined.
_DEFAULT_ESCALATE_BELOW = 0.4
_DEFAULT_HIGH_CONFIDENCE_ABOVE = 0.75


def write_guardrail_violation(
    *,
    tenant_id: str,
    suite_code: str,
    feature_code: str,
    external_case_ref: str | UUID,
    guardrail_type: GuardrailType,
    node_name: str,
    severity: GuardrailSeverity,
    details: str,
) -> UUID:
    with get_connection() as conn:
        result = conn.execute(
            text(
                """
                INSERT INTO platform_guardrail_violations (
                    tenant_id, suite_code, feature_code, external_case_ref,
                    guardrail_type, node_name, severity, details, detected_at
                ) VALUES (
                    :tenant_id, :suite_code, :feature_code, :external_case_ref,
                    :guardrail_type, :node_name, :severity, :details, :detected_at
                )
                RETURNING violation_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "suite_code": suite_code,
                "feature_code": feature_code,
                "external_case_ref": str(external_case_ref),
                "guardrail_type": guardrail_type.value,
                "node_name": node_name,
                "severity": severity.value,
                "details": details,
                "detected_at": datetime.now(UTC),
            },
        )
        violation_id = result.scalar_one()
        conn.commit()
        return violation_id


def is_feature_active(tenant_id: str, feature_code: str) -> bool:
    """True unless a feature-wide kill switch (typology_code IS NULL)
    is currently active for this tenant. Checked before Pattern
    Matching ever runs — see graph.py's _pattern_matching_node."""
    with get_connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT 1 FROM platform_kill_switch_scopes
                WHERE tenant_id = :tenant_id AND feature_code = :feature_code
                  AND typology_code IS NULL AND reactivated_at IS NULL
                LIMIT 1
                """
            ),
            {"tenant_id": tenant_id, "feature_code": feature_code},
        ).first()
    return row is None


def is_typology_active(tenant_id: str, feature_code: str, typology_code: str) -> bool:
    """False if either the whole feature or this specific typology is
    currently kill-switched. Mirrors
    specs/platform/11-evals-and-guardrails-framework.md's declared
    signature exactly."""
    if not is_feature_active(tenant_id, feature_code):
        return False
    with get_connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT 1 FROM platform_kill_switch_scopes
                WHERE tenant_id = :tenant_id AND feature_code = :feature_code
                  AND typology_code = :typology_code AND reactivated_at IS NULL
                LIMIT 1
                """
            ),
            {"tenant_id": tenant_id, "feature_code": feature_code, "typology_code": typology_code},
        ).first()
    return row is None


def get_disabled_typology_codes(tenant_id: str, feature_code: str) -> set[str]:
    """The set of individually kill-switched typology codes (not
    counting a feature-wide switch) — used to filter the Pattern
    Matching catalog prompt so a disabled typology is never presented
    as an option to reason about in the first place (guardrail G6:
    "checked ... before any typology-specific reasoning runs")."""
    with get_connection() as conn:
        rows = conn.execute(
            text(
                """
                SELECT typology_code FROM platform_kill_switch_scopes
                WHERE tenant_id = :tenant_id AND feature_code = :feature_code
                  AND typology_code IS NOT NULL AND reactivated_at IS NULL
                """
            ),
            {"tenant_id": tenant_id, "feature_code": feature_code},
        ).all()
    return {row[0] for row in rows}


def get_confidence_routing_policy(tenant_id: str, feature_code: str, typology_code: str) -> dict[str, float]:
    with get_connection() as conn:
        row = conn.execute(
            text(
                """
                SELECT escalate_below, high_confidence_above FROM platform_confidence_routing_policies
                WHERE tenant_id = :tenant_id AND feature_code = :feature_code AND typology_code = :typology_code
                """
            ),
            {"tenant_id": tenant_id, "feature_code": feature_code, "typology_code": typology_code},
        ).mappings().first()
    if row is None:
        return {"escalate_below": _DEFAULT_ESCALATE_BELOW, "high_confidence_above": _DEFAULT_HIGH_CONFIDENCE_ABOVE}
    return {"escalate_below": row["escalate_below"], "high_confidence_above": row["high_confidence_above"]}


def mark_evidence_kill_switch_active(case_id: str | UUID) -> None:
    """Set when the feature-wide kill switch short-circuits a case
    right after Evidence Gathering (see graph.py) — aml_evidence_bundles
    is the last row agent-service writes for that case, since Pattern
    Matching/Case & Narrative never run."""
    with get_connection() as conn:
        conn.execute(
            text("UPDATE aml_evidence_bundles SET kill_switch_active = true WHERE case_id = :case_id"),
            {"case_id": str(case_id)},
        )
        conn.commit()
