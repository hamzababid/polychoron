"""Phase 1 demo seed data for the mock bank API. Two scenarios, per
specs/suites/bfsi/features/aml-detection/phase-1-aml-core/mock-bank-integration-spec.md.

All names, CNICs, and account numbers are deliberately synthetic
placeholder patterns (constitution rule 10, demo-data honesty) — they
do not resemble any real individual, and CNIC/account values use
obviously-repeated digit blocks rather than plausible-looking real IDs.

The PKR 2,000,000 single-transaction threshold used below to keep
Scenario A's deposits "just under" is a fictional demo constant for
illustrating sub-threshold structuring, not an assertion of the real
regulatory CTR threshold.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.features.aml_detection.schemas import (
    KYCSnapshot,
    LinkedEntity,
    RiskTier,
    TransactionRecord,
)

DEMO_NOW = datetime(2026, 9, 16, tzinfo=UTC)

SCENARIO_A_CUSTOMER_ID = "CUST-DEMO-A1"
SCENARIO_B_CUSTOMER_ID = "CUST-DEMO-B1"

_KYC: dict[str, KYCSnapshot] = {
    SCENARIO_A_CUSTOMER_ID: KYCSnapshot(
        customer_name="Tanveer Hussain (Demo Customer)",
        cnic="11111-1111111-1",
        declared_occupation="Retail Shopkeeper",
        declared_monthly_turnover=150_000.0,
        kyc_risk_rating=RiskTier.MEDIUM,
        account_opening_date=datetime(2019, 3, 4, tzinfo=UTC),
        address="Shop 14, Al-Falah Market, Karachi (Demo Address)",
    ),
    SCENARIO_B_CUSTOMER_ID: KYCSnapshot(
        customer_name="Rukhsana Bibi (Demo Customer)",
        cnic="22222-2222222-2",
        declared_occupation="Wholesale Trader — Dry Goods",
        declared_monthly_turnover=4_500_000.0,
        kyc_risk_rating=RiskTier.LOW,
        account_opening_date=datetime(2016, 11, 20, tzinfo=UTC),
        address="Warehouse 7, Site Industrial Area, Karachi (Demo Address)",
    ),
}

_TRANSACTIONS: dict[str, list[TransactionRecord]] = {
    # Scenario A — structuring: three cash deposits just under the demo
    # CTR threshold, clustered within a few hours, across two branches.
    SCENARIO_A_CUSTOMER_ID: [
        TransactionRecord(
            txn_ref="TXN-A-1001",
            amount=1_900_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=1, hours=5),
            branch_code="BR-014",
        ),
        TransactionRecord(
            txn_ref="TXN-A-1002",
            amount=1_850_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=1, hours=3, minutes=10),
            branch_code="BR-014",
        ),
        TransactionRecord(
            txn_ref="TXN-A-1003",
            amount=1_920_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=1, hours=1, minutes=40),
            branch_code="BR-027",
        ),
    ],
    # Scenario B — high-velocity but explicable: a deposit pattern shift
    # starting ~10 days before the demo date, consistent with seasonal
    # pre-stocking for a wholesale trading business.
    SCENARIO_B_CUSTOMER_ID: [
        TransactionRecord(
            txn_ref="TXN-B-2001",
            amount=1_200_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=10),
            branch_code="BR-002",
        ),
        TransactionRecord(
            txn_ref="TXN-B-2002",
            amount=1_650_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=7),
            branch_code="BR-002",
        ),
        TransactionRecord(
            txn_ref="TXN-B-2003",
            amount=1_800_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=4),
            branch_code="BR-002",
        ),
        TransactionRecord(
            txn_ref="TXN-B-2004",
            amount=2_100_000.0,
            channel="cash_deposit",
            timestamp=DEMO_NOW - timedelta(days=1),
            branch_code="BR-002",
        ),
    ],
}

_LINKED_ENTITIES: dict[str, list[LinkedEntity]] = {
    SCENARIO_A_CUSTOMER_ID: [
        LinkedEntity(
            entity_id="CUST-DEMO-A2",
            relationship_type="shared_address",
            account_id="ACC-DEMO-A2001",
            notes="Family member; same registered address as CUST-DEMO-A1 (demo data).",
        ),
    ],
    SCENARIO_B_CUSTOMER_ID: [],
}


def get_kyc(customer_id: str) -> KYCSnapshot | None:
    return _KYC.get(customer_id)


def get_transactions(customer_id: str, days_back: int = 30) -> list[TransactionRecord]:
    cutoff = DEMO_NOW - timedelta(days=days_back)
    return [t for t in _TRANSACTIONS.get(customer_id, []) if t.timestamp >= cutoff]


def get_linked_entities(customer_id: str) -> list[LinkedEntity]:
    return _LINKED_ENTITIES.get(customer_id, [])
