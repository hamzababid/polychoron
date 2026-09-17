"""The Evidence Gathering Agent's "internal prior-case lookup" tool
(agent-implementation.md's tool allowlist for Node 1) — reads directly
from aml_cases/aml_typology_matches/aml_dispositions, the same
Postgres tables app-api owns writes to. This is a read, not a write,
so it stays inside the boundary spec's "both services read freely
across this line" rule."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.schemas import PriorCaseSummary

_QUERY = text(
    """
    SELECT
        c.case_id,
        c.created_at AS opened_at,
        c.closed_at,
        t.typology_code,
        d.disposition_type
    FROM aml_cases c
    LEFT JOIN aml_typology_matches t ON t.case_id = c.case_id
    LEFT JOIN aml_dispositions d ON d.case_id = c.case_id
    WHERE (c.alert ->> 'customer_id') = :customer_id
      AND c.case_id != :current_case_id
    ORDER BY c.created_at DESC
    """
)


def get_prior_cases(customer_id: str, current_case_id: str | UUID) -> list[PriorCaseSummary]:
    with get_connection() as conn:
        rows = conn.execute(
            _QUERY, {"customer_id": customer_id, "current_case_id": str(current_case_id)}
        ).mappings().all()

    return [
        PriorCaseSummary(
            case_id=row["case_id"],
            typology=row["typology_code"] or "unclassified",
            opened_at=row["opened_at"],
            closed_at=row["closed_at"],
            final_disposition=row["disposition_type"],
        )
        for row in rows
    ]
