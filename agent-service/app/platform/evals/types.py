"""Mirrors specs/platform/02-platform-data-models.py's Guardrails &
Evals section, and specs/platform/11-evals-and-guardrails-framework.md
PART 2."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class GoldenDatasetCase(BaseModel):
    case_id: UUID = Field(default_factory=uuid4)
    feature_code: str
    scenario_name: str
    input_evidence_fixture: dict
    expected_typology: str | None = None
    expected_recommendation: str | None = None
    expected_confidence_min: float | None = None
    expected_confidence_max: float | None = None
    tags: list[str] = []
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EvalCaseResult(BaseModel):
    result_id: UUID = Field(default_factory=uuid4)
    run_id: UUID
    golden_case_id: UUID
    actual_typology: str | None = None
    actual_recommendation: str | None = None
    actual_confidence: float | None = None
    matched_expected: bool
    notes: str | None = None


class EvalRun(BaseModel):
    run_id: UUID = Field(default_factory=uuid4)
    feature_code: str
    agent_version_under_test: str
    triggered_by: str
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    total_cases: int
    passed: int = 0
    failed: int = 0
    faithfulness_score_avg: float | None = None
    consistency_variance: float | None = None
    status: str = "running"


class FairnessMonitoringSnapshot(BaseModel):
    snapshot_id: UUID = Field(default_factory=uuid4)
    tenant_id: str
    feature_code: str
    period_start: datetime
    period_end: datetime
    segment_dimension: str
    segment_value: str
    str_recommendation_rate: float
    false_positive_rate: float
    baseline_deviation: float
    flagged: bool = False
