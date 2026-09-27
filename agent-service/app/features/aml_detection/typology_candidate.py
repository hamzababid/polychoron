"""The Typology Console's candidate catalog — evaluation only.
specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
("Promotion gate").

A draft is evaluated by running the golden dataset through the real
Pattern Matching node with the production catalog *plus this draft
substituted in*: added if it's a new typology, replacing the promoted
version if it's an edit, removed if the draft retires it
(active=false). Only typology_regression.py may call this —
test_typology_candidate_isolation.py keeps it off every production path.
"""

from __future__ import annotations

from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.typology_config_repository import Catalog, get_active_typologies


class CandidateNotADraft(Exception):
    """The version asked for isn't an open draft — nothing to evaluate."""


_SELECT_DRAFT = text(
    """
    SELECT typology_code, version, typology_label, rule_logic_description, active,
           aml_typology_candidate_key(typology_code, version, content_hash) AS candidate_key
    FROM aml_typology_config_versions
    WHERE typology_code = :code AND version = :version AND status = 'draft'
    """
)


def candidate_catalog(typology_code: str, version: int) -> tuple[Catalog, str]:
    """Returns (catalog, candidate_key). The key — computed by the same
    SQL function the promotion guard uses — ties an eval run to this
    exact draft content, so editing the draft afterwards makes the run
    stale rather than silently still counting."""
    with get_connection() as conn:
        draft = conn.execute(_SELECT_DRAFT, {"code": typology_code, "version": version}).mappings().first()
    if draft is None:
        raise CandidateNotADraft(f"{typology_code} v{version} is not an open draft")

    catalog = [t for t in get_active_typologies() if t["typology_code"] != typology_code]
    if draft["active"]:
        catalog.append(
            {
                "typology_code": draft["typology_code"],
                "typology_label": draft["typology_label"],
                "rule_logic_description": draft["rule_logic_description"],
                "version": draft["version"],
            }
        )
    catalog.sort(key=lambda t: t["typology_code"])
    return catalog, draft["candidate_key"]
