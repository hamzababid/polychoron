"""specs/suites/bfsi/features/aml-detection/phase-1-aml-core/mock-bank-integration-spec.md

A small internal HTTP service standing in for the bank's real
core-banking + KYC integration. The Evidence Gathering Agent calls this
over HTTP exactly like it would call a real integration — swapping in
Phase 3's real adapter is a config change (a different base URL), not a
rewrite of the agent's tool-calling code."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.features.aml_detection.mock_bank import seed_data
from app.features.aml_detection.schemas import KYCSnapshot, LinkedEntity, TransactionRecord

router = APIRouter(prefix="/mock-bank", tags=["mock-bank"])


@router.get("/kyc/{customer_id}", response_model=KYCSnapshot)
def get_kyc(customer_id: str) -> KYCSnapshot:
    kyc = seed_data.get_kyc(customer_id)
    if kyc is None:
        raise HTTPException(status_code=404, detail=f"No KYC record for customer_id={customer_id!r}")
    return kyc


@router.get("/transactions/{customer_id}", response_model=list[TransactionRecord])
def get_transactions(customer_id: str, days_back: int = 30) -> list[TransactionRecord]:
    return seed_data.get_transactions(customer_id, days_back=days_back)


@router.get("/linked-entities/{customer_id}", response_model=list[LinkedEntity])
def get_linked_entities(customer_id: str) -> list[LinkedEntity]:
    return seed_data.get_linked_entities(customer_id)
