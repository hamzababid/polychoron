"""specs/suites/bfsi/features/aml-detection/phase-1-aml-core/mock-bank-integration-spec.md
"Alert injection" — simulates what a real bank's TMS webhook would send
by posting an InboundAlert to app-api's ingestion endpoint, for each of
the two demo scenarios. This is what triggers the agent chain during
the live demo.

Usage:
    python scripts/inject_demo_alert.py            # both scenarios
    python scripts/inject_demo_alert.py --only a    # just Scenario A
    python scripts/inject_demo_alert.py --only b    # just Scenario B
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx

APP_API_BASE_URL = os.environ.get("APP_API_BASE_URL", "http://localhost:3000")
INGEST_PATH = "/api/v1/features/aml_detection/alerts/ingest"

SCENARIO_A_ALERT = {
    "source_alert_id": "TMS-ALERT-DEMO-A",
    "source_system": "CoreTMS-DemoBank",
    "customer_id": "CUST-DEMO-A1",
    "account_ids": ["ACC-DEMO-A1001"],
    "transaction_refs": ["TXN-A-1001", "TXN-A-1002", "TXN-A-1003"],
    "rule_fired": "sub_threshold_cash_structuring",
    "risk_tier_hint": "high",
}

SCENARIO_B_ALERT = {
    "source_alert_id": "TMS-ALERT-DEMO-B",
    "source_system": "CoreTMS-DemoBank",
    "customer_id": "CUST-DEMO-B1",
    "account_ids": ["ACC-DEMO-B1001"],
    "transaction_refs": ["TXN-B-2001", "TXN-B-2002", "TXN-B-2003", "TXN-B-2004"],
    "rule_fired": "deposit_velocity_shift",
    "risk_tier_hint": "medium",
}


def inject(alert: dict) -> None:
    url = f"{APP_API_BASE_URL}{INGEST_PATH}"
    response = httpx.post(url, json=alert, timeout=10.0)
    response.raise_for_status()
    body = response.json()
    print(f"Injected {alert['source_alert_id']!r} -> case_id={body['caseId']} workflow_id={body['workflowId']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["a", "b"], help="Inject only one scenario")
    args = parser.parse_args()

    scenarios = {
        "a": SCENARIO_A_ALERT,
        "b": SCENARIO_B_ALERT,
    }
    to_inject = [scenarios[args.only]] if args.only else list(scenarios.values())

    for alert in to_inject:
        inject(alert)
    return 0


if __name__ == "__main__":
    sys.exit(main())
