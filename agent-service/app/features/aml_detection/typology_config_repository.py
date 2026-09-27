"""Reads the Pattern Matching Agent's typology catalog from
aml_typology_configs — the real Typology & Rules Console (Phase 2),
replacing Phase 1's hardcoded typology_catalog.py list. Read-only from
agent-service: aml_typology_configs is owned (writes) by app-api's
Typology Console, per
specs/platform/09-backend-service-boundary-spec.md."""

from __future__ import annotations

from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.typology_catalog import DEMO_CASH_REPORTING_THRESHOLD_PKR
from app.platform.guardrails.repository import get_disabled_typology_codes

# Only the promoted version is ever read here — drafts and never-
# promoted typologies are invisible to the production agent chain by
# construction (migration 014; screens/06-typology-rules-console.md).
_SELECT_ACTIVE = text(
    """
    SELECT c.typology_code, v.typology_label, v.rule_logic_description, v.version
    FROM aml_typology_configs c
    JOIN aml_typology_config_versions v
      ON v.typology_code = c.typology_code AND v.version = c.production_version
    WHERE v.active = true
    ORDER BY c.typology_code
    """
)


# A catalog is a list of {typology_code, typology_label,
# rule_logic_description, version}. Production always passes None and
# reads the promoted catalog; only the Typology Console's golden-
# dataset regression passes a candidate (typology_candidate.py).
Catalog = list[dict]


def get_active_typologies() -> Catalog:
    with get_connection() as conn:
        rows = conn.execute(_SELECT_ACTIVE).mappings().all()
    return [dict(row) for row in rows]


def offered_catalog(tenant_id: str, feature_code: str = "aml_detection", catalog: Catalog | None = None) -> Catalog:
    """The catalog actually presented to the Pattern Matching Agent —
    promoted-and-active (or the given candidate), minus any typology
    under a kill switch (guardrail G6)."""
    disabled = get_disabled_typology_codes(tenant_id, feature_code)
    source = get_active_typologies() if catalog is None else catalog
    return [t for t in source if t["typology_code"] not in disabled]


def get_offered_typology_codes(
    tenant_id: str, feature_code: str = "aml_detection", catalog: Catalog | None = None
) -> list[str]:
    """The typology codes actually presented to the Pattern Matching
    Agent — active in the Typology Console and not under a kill switch.
    Also scopes regulatory retrieval: a KB document restricted to other
    typologies isn't offered as a candidate citation."""
    return [t["typology_code"] for t in offered_catalog(tenant_id, feature_code, catalog)]


def active_catalog_as_prompt_block(
    tenant_id: str, feature_code: str = "aml_detection", catalog: Catalog | None = None
) -> str:
    """Guardrail G6: a typology under an active per-typology kill
    switch is excluded from the catalog entirely, so the Pattern
    Matching Agent structurally cannot reason about it — the strongest
    form of "checked ... before any typology-specific reasoning runs"
    (specs/platform/11-evals-and-guardrails-framework.md)."""
    typologies = offered_catalog(tenant_id, feature_code, catalog)

    lines = [
        (
            f"Cash reporting threshold for this exercise: PKR {DEMO_CASH_REPORTING_THRESHOLD_PKR:,} "
            "per transaction (a fictional demo constant)."
        ),
        "Active typology catalog (from the Typology & Rules Console):",
    ]
    for t in typologies:
        lines.append(f"- {t['typology_code']} ({t['typology_label']}): {t['rule_logic_description']}")
    if not typologies:
        lines.append("- (no active typologies configured)")
    return "\n".join(lines)
