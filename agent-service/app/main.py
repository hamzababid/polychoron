"""agent-service's FastAPI app. Per
specs/platform/09-backend-service-boundary-spec.md, this process hosts:
the mock bank integration (Phase 1 stand-in for real core-banking/KYC),
and — separately, run via `python -m app.features.aml_detection.worker`
— the Temporal worker that executes the LangGraph-based AML workflow.
This app never serves screen-facing endpoints; that's app-api's job."""

from __future__ import annotations

from fastapi import FastAPI

from app.features.aml_detection.mock_bank.router import router as mock_bank_router

app = FastAPI(title="Polychoron AI — Agent Orchestration Service")

app.include_router(mock_bank_router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
