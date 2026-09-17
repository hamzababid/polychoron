from __future__ import annotations

from fastapi.testclient import TestClient

from app.features.aml_detection.mock_bank.seed_data import (
    SCENARIO_A_CUSTOMER_ID,
    SCENARIO_B_CUSTOMER_ID,
)
from app.main import app

client = TestClient(app)


def test_kyc_scenario_a():
    res = client.get(f"/mock-bank/kyc/{SCENARIO_A_CUSTOMER_ID}")
    assert res.status_code == 200
    body = res.json()
    assert body["kyc_risk_rating"] == "medium"
    assert body["declared_monthly_turnover"] == 150_000.0


def test_kyc_unknown_customer_404():
    res = client.get("/mock-bank/kyc/does-not-exist")
    assert res.status_code == 404


def test_transactions_scenario_a_shows_structuring_pattern():
    res = client.get(f"/mock-bank/transactions/{SCENARIO_A_CUSTOMER_ID}", params={"days_back": 30})
    assert res.status_code == 200
    txns = res.json()
    assert len(txns) == 3
    assert all(t["channel"] == "cash_deposit" for t in txns)
    assert all(t["amount"] < 2_000_000 for t in txns)


def test_transactions_scenario_b_shows_seasonal_shift():
    res = client.get(f"/mock-bank/transactions/{SCENARIO_B_CUSTOMER_ID}", params={"days_back": 30})
    assert res.status_code == 200
    txns = res.json()
    assert len(txns) == 4


def test_transactions_days_back_filters_window():
    res = client.get(f"/mock-bank/transactions/{SCENARIO_B_CUSTOMER_ID}", params={"days_back": 5})
    assert res.status_code == 200
    txns = res.json()
    assert len(txns) == 2  # only the two most recent fall within 5 days of DEMO_NOW


def test_linked_entities_scenario_a_has_family_member():
    res = client.get(f"/mock-bank/linked-entities/{SCENARIO_A_CUSTOMER_ID}")
    assert res.status_code == 200
    entities = res.json()
    assert len(entities) == 1
    assert entities[0]["relationship_type"] == "shared_address"


def test_linked_entities_scenario_b_is_clean():
    res = client.get(f"/mock-bank/linked-entities/{SCENARIO_B_CUSTOMER_ID}")
    assert res.status_code == 200
    assert res.json() == []
