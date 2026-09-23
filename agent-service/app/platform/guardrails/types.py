"""Mirrors specs/platform/02-platform-data-models.py's Guardrails &
Evals section, and specs/platform/11-evals-and-guardrails-framework.md."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class GuardrailType(str, Enum):
    EVIDENCE_COMPLETENESS = "evidence_completeness"
    PROMPT_INJECTION_FILTER = "prompt_injection_filter"
    CITATION_FABRICATION_CHECK = "citation_fabrication_check"
    SCHEMA_VALIDATION = "schema_validation"
    CONFIDENCE_ROUTING = "confidence_routing"
    PII_REDACTION = "pii_redaction"
    KILL_SWITCH = "kill_switch"


class GuardrailSeverity(str, Enum):
    BLOCKED = "blocked"
    FLAGGED = "flagged"
    ESCALATED = "escalated"


class GuardrailViolation(BaseModel):
    violation_id: UUID = Field(default_factory=uuid4)
    tenant_id: str
    suite_code: str
    feature_code: str
    external_case_ref: str
    guardrail_type: GuardrailType
    node_name: str
    severity: GuardrailSeverity
    details: str
    detected_at: datetime = Field(default_factory=datetime.utcnow)


class ConfidenceRoutingPolicy(BaseModel):
    tenant_id: str
    feature_code: str
    typology_code: str
    escalate_below: float = Field(..., ge=0, le=1)
    high_confidence_above: float = Field(..., ge=0, le=1)
    updated_by: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class KillSwitchScope(BaseModel):
    scope_id: UUID = Field(default_factory=uuid4)
    tenant_id: str
    feature_code: str
    typology_code: str | None = None
    disabled_by: str
    disabled_at: datetime = Field(default_factory=datetime.utcnow)
    reason: str
    reactivated_at: datetime | None = None
    reactivated_by: str | None = None
