"""
Polychoron AI — Core data models
Case record, agent input/output schemas, and filing structures for the
Option A (alert-driven) architecture.

These are the contracts every agent, screen, and MLOps trace point is
built against. Each agent's output schema doubles as the validation gate
described in the framework doc: if a model's output doesn't conform to
these shapes, the workflow retries or escalates rather than passing
malformed data downstream.
"""

from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------
# Enums — fixed vocabularies used across every screen and agent
# ---------------------------------------------------------------------

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


class CaseStatus(str, Enum):
    OPEN = "open"
    CLAIMED = "claimed"
    INVESTIGATING = "investigating"
    CLEARED = "cleared"
    ESCALATED = "escalated"
    PENDING_FILING = "pending_filing"
    FILED = "filed"


class FilingSubmissionStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    ACKNOWLEDGED = "acknowledged"
    FEEDBACK_RECEIVED = "feedback_received"


class ReportType(str, Enum):
    STR_F = "str_f"
    CTR = "ctr"
    CTR_A = "ctr_a"
    STR_A = "str_a"


# ---------------------------------------------------------------------
# Inbound: what the bank's TMS sends when a rule fires (Option A entry point)
# ---------------------------------------------------------------------

class InboundAlert(BaseModel):
    """Raw payload received via webhook from the bank's existing TMS.
    Polychoron AI does not generate this — it's the Option A trigger."""
    source_alert_id: str = Field(..., description="The bank TMS's own alert/case ID")
    source_system: str = Field(..., description="e.g. 'CoreTMS-BankXYZ'")
    customer_id: str
    account_ids: list[str]
    transaction_refs: list[str]
    rule_fired: str = Field(..., description="Name/code of the bank's own rule that triggered")
    risk_tier_hint: Optional[RiskTier] = Field(None, description="Bank's own severity, if provided")
    received_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------
# Agent 1 — Evidence Gathering Agent
# ---------------------------------------------------------------------

class TransactionRecord(BaseModel):
    txn_ref: str
    amount: float
    currency: str = "PKR"
    channel: str  # e.g. "cash_deposit", "rtgs", "swift", "card"
    timestamp: datetime
    counterparty_account: Optional[str] = None
    branch_code: Optional[str] = None


class LinkedEntity(BaseModel):
    entity_id: str
    relationship_type: str  # e.g. "shared_address", "shared_signatory", "counterparty"
    account_id: Optional[str] = None
    notes: Optional[str] = None


class ScreeningResult(BaseModel):
    list_source: str  # e.g. "UN Consolidated List", "PEP Database"
    matched_name: str
    match_confidence: float = Field(..., ge=0, le=1)
    match_rationale: str
    disposition: Optional[str] = None  # "true_match" / "false_match", set by human


class PriorCaseSummary(BaseModel):
    case_id: UUID
    typology: str
    opened_at: datetime
    closed_at: Optional[datetime] = None
    final_disposition: Optional[DispositionType] = None


class KYCSnapshot(BaseModel):
    customer_name: str
    cnic: str
    declared_occupation: str
    declared_monthly_turnover: Optional[float] = None
    kyc_risk_rating: RiskTier
    account_opening_date: datetime
    address: str


class EvidenceBundle(BaseModel):
    """Output of the Evidence Gathering Agent. Populates the left panel
    of Case Workspace and the Customer 360 screen."""
    case_id: UUID
    kyc: KYCSnapshot
    transaction_timeline: list[TransactionRecord]
    linked_entities: list[LinkedEntity]
    prior_cases: list[PriorCaseSummary]
    screening_results: list[ScreeningResult]
    assembled_at: datetime = Field(default_factory=datetime.utcnow)
    agent_version: str


# ---------------------------------------------------------------------
# Agent 2 — Pattern Matching Agent
# ---------------------------------------------------------------------

class MatchedIndicator(BaseModel):
    """A single FMU red-flag indicator that fired, e.g. one line from
    the structuring category."""
    indicator_code: str
    indicator_description: str
    contributing_evidence: str  # plain-language pointer to which evidence triggered it


class TypologyMatch(BaseModel):
    """Output of the Pattern Matching Agent. Drives the typology pill on
    Alert Queue and the 'AI-drafted' reasoning block on Case Workspace."""
    case_id: UUID
    typology_code: str  # e.g. "structuring_subthreshold"
    typology_label: str  # e.g. "Structuring — sub-threshold cash deposits"
    confidence: float = Field(..., ge=0, le=1)
    matched_indicators: list[MatchedIndicator]
    plain_language_rationale: str
    matched_at: datetime = Field(default_factory=datetime.utcnow)
    agent_version: str


# ---------------------------------------------------------------------
# Agent 3 — Case and Narrative Agent
# ---------------------------------------------------------------------

class STRFieldsDraft(BaseModel):
    """Pre-populated STR-F fields — structured, factual, agent-fillable
    fields only. Suspicion determination is NOT part of this schema by
    design; that stays with the human at the Filing Console."""
    party_name: str
    party_cnic: str
    party_address: str
    party_occupation: str
    account_ids: list[str]
    transaction_refs: list[str]
    total_amount: float
    currency: str = "PKR"
    typology_tag: str
    reporting_entity: str  # the bank's own institution code


class CaseAssessment(BaseModel):
    """Output of the Case and Narrative Agent. This is the object an
    analyst sees the moment they open Alert Queue or Case Workspace."""
    case_id: UUID
    risk_score: int = Field(..., ge=0, le=100)
    recommendation: AgentRecommendation
    recommendation_confidence: float = Field(..., ge=0, le=1)
    draft_narrative: str = Field(..., description="Factual reconstruction only — not a suspicion claim")
    str_fields_draft: Optional[STRFieldsDraft] = None
    assessed_at: datetime = Field(default_factory=datetime.utcnow)
    agent_version: str


# ---------------------------------------------------------------------
# Human checkpoint output
# ---------------------------------------------------------------------

class Disposition(BaseModel):
    """The officer's decision. Always human-authored; never
    auto-populated by an agent."""
    case_id: UUID
    officer_id: str
    disposition_type: DispositionType
    officer_notes: str
    overrides_agent_recommendation: bool = False
    override_reason: Optional[str] = Field(
        None, description="Required if overrides_agent_recommendation is True"
    )
    decided_at: datetime = Field(default_factory=datetime.utcnow)

    def model_post_init(self, __context) -> None:
        if self.overrides_agent_recommendation and not self.override_reason:
            raise ValueError("override_reason is required when overriding the agent's recommendation")


# ---------------------------------------------------------------------
# Filing Console → goAML
# ---------------------------------------------------------------------

class OfficerAttestation(BaseModel):
    officer_id: str
    officer_name: str
    officer_role: str
    tipping_off_checklist_complete: bool
    attestation_confirmed: bool
    attested_at: Optional[datetime] = None

    @property
    def can_submit(self) -> bool:
        return self.tipping_off_checklist_complete and self.attestation_confirmed


class STRFiling(BaseModel):
    filing_id: UUID = Field(default_factory=uuid4)
    case_id: UUID
    report_type: ReportType
    payload: STRFieldsDraft
    final_narrative: str = Field(..., description="Officer-approved narrative, may differ from agent draft")
    attestation: OfficerAttestation
    submission_status: FilingSubmissionStatus = FilingSubmissionStatus.DRAFT
    goaml_reference: Optional[str] = None
    submitted_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    retention_expiry: Optional[datetime] = Field(
        None, description="submitted_at + 10 years, per AMLA record retention"
    )


# ---------------------------------------------------------------------
# The Case — the object that ties everything together
# ---------------------------------------------------------------------

class Case(BaseModel):
    case_id: UUID = Field(default_factory=uuid4)
    alert: InboundAlert
    status: CaseStatus = CaseStatus.OPEN
    assigned_analyst_id: Optional[str] = None
    evidence: Optional[EvidenceBundle] = None
    typology_match: Optional[TypologyMatch] = None
    assessment: Optional[CaseAssessment] = None
    disposition: Optional[Disposition] = None
    filing: Optional[STRFiling] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    closed_at: Optional[datetime] = None


# ---------------------------------------------------------------------
# Agent Activity Log — the audit trail, one entry per agent invocation
# ---------------------------------------------------------------------

class AgentActivityLogEntry(BaseModel):
    """One immutable row per agent call. This is the literal backing
    data for the Agent Activity Log screen and Layer 1 of the MLOps
    tracing system."""
    log_id: UUID = Field(default_factory=uuid4)
    case_id: UUID
    agent_name: str  # "evidence_gathering" | "pattern_matching" | "case_narrative"
    agent_version: str
    input_payload: dict
    output_payload: dict
    confidence: Optional[float] = None
    latency_ms: int
    data_sources_queried: list[str]
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------
# Sampling record — feeds Model Governance & Audit's agreement-rate panel
# ---------------------------------------------------------------------

class SamplingReview(BaseModel):
    case_id: UUID
    original_disposition: DispositionType
    reviewer_id: str
    reviewer_agreed: bool
    reviewer_notes: Optional[str] = None
    reviewed_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------
# PHASE 1 ONLY — minimal demo auth stub.
# This is NOT the Phase 3 RBAC system. It exists solely so Phase 1 has
# something to gate routes with, without building real SSO. Replace
# entirely with the Phase 3 spec's role/session model when that phase
# starts — do not try to evolve this stub into production auth.
# ---------------------------------------------------------------------

class DemoRole(str, Enum):
    """Simplified stand-in for the full Phase 3 role set. Phase 1 only
    needs to distinguish 'can investigate' from 'can file'."""
    ANALYST = "analyst"
    COMPLIANCE_OFFICER = "compliance_officer"


class DemoUser(BaseModel):
    """A hardcoded/seeded user for demo purposes only."""
    user_id: str
    display_name: str
    role: DemoRole


class DemoSession(BaseModel):
    """Minimal session object. No token refresh, no expiry handling,
    no MFA — none of that is in scope until Phase 3."""
    session_id: str
    user: DemoUser
    created_at: datetime = Field(default_factory=datetime.utcnow)
