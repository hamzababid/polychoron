"""agent-service's FastAPI app. Per
specs/platform/09-backend-service-boundary-spec.md, this process hosts:
the mock bank integration (Phase 1 stand-in for real core-banking/KYC),
and — separately, run via `python -m app.features.aml_detection.worker`
— the Temporal worker that executes the LangGraph-based AML workflow.
This app never serves screen-facing endpoints; that's app-api's job.

Swagger UI / ReDoc / the raw OpenAPI schema are all served automatically
by FastAPI at /docs, /redoc and /openapi.json — nothing to wire up for
that beyond the response_model= typing the mock bank router already has."""

from __future__ import annotations

import time
from uuid import uuid4

from fastapi import FastAPI, Request

from app.features.aml_detection.mock_bank.router import router as mock_bank_router
from app.platform.logging import configure_logging, get_logger, set_correlation_id

configure_logging()
logger = get_logger("agent-service.http")

app = FastAPI(
    title="Polychoron AI — Agent Orchestration Service",
    description="Mock bank integration (KYC/transactions/linked entities) — the only HTTP surface this "
    "service exposes. The actual agent chain runs as Temporal activities, not REST endpoints; "
    "see the Temporal UI (:8080) for workflow-level tracing, and the correlation_id on every "
    "log line here for request-level tracing.",
)

app.include_router(mock_bank_router)


@app.middleware("http")
async def correlation_id_and_access_log(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id") or str(uuid4())
    set_correlation_id(correlation_id)
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000
    response.headers["x-correlation-id"] = correlation_id
    logger.info(
        "%s %s %s %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
