"""Seeds the one piece of AML demo data that must live in Postgres
rather than the in-code mock-bank fixtures: Scenario A's prior,
unrelated, already-cleared case on CUST-DEMO-A1 (per
phase-1-aml-core/mock-bank-integration-spec.md's Scenario A
requirements), which the Evidence Gathering Agent's internal
prior-case-lookup tool reads directly from aml_cases/aml_dispositions.

A minimal demo-analyst platform_users row is seeded alongside it only
because aml_dispositions.officer_id has a foreign key to
platform_users — the full 2-demo-user seed (with real DemoUser/
DemoSession wiring) is a separate, later task
("Platform — Demo Auth Stub"); this script upserts the same user_id so
that task can seed over it without conflict.

Idempotent — safe to re-run.

Usage:
    python scripts/seed_aml_demo_data.py
"""

from __future__ import annotations

import json
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text

from app.db import get_connection
from app.features.aml_detection.mock_bank.seed_data import DEMO_NOW, SCENARIO_A_CUSTOMER_ID
from scripts.seed_platform_registry import DEMO_TENANT_ID

DEMO_ANALYST_USER_ID = "demo-analyst-1"
PRIOR_CASE_ID = "a1a1a1a1-0000-4000-8000-000000000001"  # fixed, so this script is idempotent


def seed_demo_analyst_user() -> None:
    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO platform_users (user_id, tenant_id, display_name, email, role_codes)
                VALUES (:id, :tenant_id, :name, :email, :roles)
                ON CONFLICT (user_id) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    email = EXCLUDED.email
                """
            ),
            {
                "id": DEMO_ANALYST_USER_ID,
                "tenant_id": DEMO_TENANT_ID,
                "name": "Demo Analyst (Seed)",
                "email": "demo-analyst@example.test",
                "roles": ["aml_detection.analyst_l1"],
            },
        )
        conn.commit()
    print(f"Seeded platform_users row for {DEMO_ANALYST_USER_ID!r}")


def seed_prior_cleared_case() -> None:
    opened_at = DEMO_NOW - timedelta(days=240)
    closed_at = DEMO_NOW - timedelta(days=230)

    alert = {
        "source_alert_id": "TMS-ALERT-DEMO-A-PRIOR",
        "source_system": "CoreTMS-DemoBank",
        "customer_id": SCENARIO_A_CUSTOMER_ID,
        "account_ids": ["ACC-DEMO-A1001"],
        "transaction_refs": ["TXN-A-0001"],
        "rule_fired": "high_value_single_transaction",
        "risk_tier_hint": "low",
        "received_at": opened_at.isoformat(),
    }

    with get_connection() as conn:
        conn.execute(
            text(
                """
                INSERT INTO aml_cases (case_id, tenant_id, alert, status, created_at, closed_at)
                VALUES (:id, :tenant_id, cast(:alert as jsonb), 'cleared', :created_at, :closed_at)
                ON CONFLICT (case_id) DO NOTHING
                """
            ),
            {
                "id": PRIOR_CASE_ID,
                "tenant_id": DEMO_TENANT_ID,
                "alert": json.dumps(alert),
                "created_at": opened_at,
                "closed_at": closed_at,
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO aml_dispositions (
                    case_id, officer_id, disposition_type, officer_notes,
                    overrides_agent_recommendation, decided_at
                ) VALUES (
                    :case_id, :officer_id, 'clear', :notes, false, :decided_at
                )
                ON CONFLICT (case_id) DO NOTHING
                """
            ),
            {
                "case_id": PRIOR_CASE_ID,
                "officer_id": DEMO_ANALYST_USER_ID,
                "notes": (
                    "Reviewed: isolated high-value transaction, corroborated by "
                    "supporting documentation as a one-off inheritance-linked "
                    "deposit. No further activity of concern. (Demo data.)"
                ),
                "decided_at": closed_at,
            },
        )
        conn.commit()
    print(f"Seeded prior cleared case {PRIOR_CASE_ID!r} for {SCENARIO_A_CUSTOMER_ID!r}")


def main() -> None:
    seed_demo_analyst_user()
    seed_prior_cleared_case()


if __name__ == "__main__":
    main()
