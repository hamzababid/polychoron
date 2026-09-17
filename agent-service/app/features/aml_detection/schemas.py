"""Mirrors specs/suites/bfsi/features/aml-detection/data-models.py.
agent-service only needs the enums and the agent I/O schemas (it never
serves Case/Disposition/STRFiling screen-facing endpoints — those are
app-api's, per the boundary spec)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class RiskTier(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class AgentRecommendation(str, Enum):
    CLEAR = "clear"
    ESCALATE = "escalate"
    RECOMMEND_STR = "recommend_str"
    RECOMMEND_CTR = "recommend_ctr"


class DispositionType(str, Enum):
    CLEAR = "clear"
    ENHANCED_MONITORING = "enhanced_monitoring"
    ESCALATE_SENIOR = "escalate_senior"
    FILE_STR = "file_str"
    FILE_CTR = "file_ctr"


class InboundAlert(BaseModel):
    source_alert_id: str
    source_system: str
    customer_id: str
    account_ids: list[str]
    transaction_refs: list[str]
    rule_fired: str
    risk_tier_hint: RiskTier | None = None
    received_at: datetime = Field(default_factory=datetime.utcnow)


class TransactionRecord(BaseModel):
    txn_ref: str
    amount: float
    currency: str = "PKR"
    channel: str
    timestamp: datetime
    counterparty_account: str | None = None
    branch_code: str | None = None


class LinkedEntity(BaseModel):
    entity_id: str
    relationship_type: str
    account_id: str | None = None
    notes: str | None = None


class ScreeningResult(BaseModel):
    list_source: str
    matched_name: str
    match_confidence: float = Field(..., ge=0, le=1)
    match_rationale: str
    disposition: str | None = None


class PriorCaseSummary(BaseModel):
    case_id: UUID
    typology: str
    opened_at: datetime
    closed_at: datetime | None = None
    final_disposition: DispositionType | None = None


class KYCSnapshot(BaseModel):
    customer_name: str
    cnic: str
    declared_occupation: str
    declared_monthly_turnover: float | None = None
    kyc_risk_rating: RiskTier
    account_opening_date: datetime
    address: str


class EvidenceBundle(BaseModel):
    case_id: UUID
    kyc: KYCSnapshot
    transaction_timeline: list[TransactionRecord]
    linked_entities: list[LinkedEntity]
    prior_cases: list[PriorCaseSummary]
    screening_results: list[ScreeningResult]
    assembled_at: datetime = Field(default_factory=datetime.utcnow)
    agent_version: str


class MatchedIndicator(BaseModel):
    indicator_code: str
    indicator_description: str
    contributing_evidence: str


class TypologyMatch(BaseModel):
    case_id: UUID
    typology_code: str
    typology_label: str
    confidence: float = Field(..., ge=0, le=1)
    matched_indicators: list[MatchedIndicator]
    plain_language_rationale: str
    matched_at: datetime = Field(default_factory=datetime.utcnow)
    agent_version: str


class STRFieldsDraft(BaseModel):
    party_name: str
    party_cnic: str
    party_address: str
    party_occupation: str
    account_ids: list[str]
    transaction_refs: list[str]
    total_amount: float
    currency: str = "PKR"
    typology_tag: str
    reporting_entity: str


class CaseAssessment(BaseModel):
    case_id: UUID
    risk_score: int = Field(..., ge=0, le=100)
    recommendation: AgentRecommendation
    recommendation_confidence: float = Field(..., ge=0, le=1)
    draft_narrative: str
    str_fields_draft: STRFieldsDraft | None = None
    assessed_at: datetime = Field(default_factory=datetime.utcnow)
    agent_version: str


class CaseNarrativeInput(BaseModel):
    """Node 3's input is EvidenceBundle + TypologyMatch
    (agent-implementation.md) — combined into one object since
    PlatformAgentNode.run() takes a single typed input.

    account_ids is threaded in separately from the original
    InboundAlert: EvidenceBundle has no field for "which bank accounts
    were involved" (TransactionRecord only carries counterparty_account,
    not the customer's own account), but STRFieldsDraft needs it."""

    evidence: EvidenceBundle
    typology_match: TypologyMatch
    account_ids: list[str]
