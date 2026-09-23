"""Structured logging + correlation ID propagation, platform-wide.

Mirrors app-api's correlation-id middleware/Winston setup (see
app-api/src/common/logging/) — the same correlation_id an app-api
request mints travels through the Temporal workflow's own input
payload (the two services never call each other directly, so that
payload is the only bridge) and lands here via set_correlation_id(),
so one correlation_id ties an HTTP request's app-api access-log line
to the agent-service activity/node log lines it triggered.

This is operational tracing only — it does not touch, and is not a
substitute for, platform_agent_activity_log (constitution rule 3's
audit-of-record), which stays exactly as it was.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
from contextvars import ContextVar
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import settings

_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_case_id: ContextVar[str | None] = ContextVar("case_id", default=None)

_RESERVED_LOG_RECORD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()) | {
    # Not present on a fresh LogRecord — Formatter.format() sets this
    # as a side effect on the record itself (shared across every
    # handler processing that record) only when %(asctime)s appears in
    # a format string, e.g. the console handler's. Without this
    # explicit exclusion it leaks into the JSON file output as a
    # stray, redundant field whenever the console handler happens to
    # run first.
    "asctime",
}


def set_correlation_id(correlation_id: str | None) -> None:
    _correlation_id.set(correlation_id)


def get_correlation_id() -> str | None:
    return _correlation_id.get()


def set_case_id(case_id: str | None) -> None:
    _case_id.set(case_id)


def get_case_id() -> str | None:
    return _case_id.get()


class _ContextFilter(logging.Filter):
    """Stamps the current correlation_id/case_id onto every record —
    same reasoning as app-api's withCorrelationId winston format: a
    caller never passes these explicitly on a one-off log call, so
    they can't be forgotten."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = get_correlation_id()
        record.case_id = get_case_id()
        return True


class _JsonFormatter(logging.Formatter):
    """One JSON object per line — meant to be grepped/parsed by
    correlation_id to reconstruct one request's full story, not read
    by eye (that's what the console handler is for)."""

    def format(self, record: logging.LogRecord) -> str:
        # self.formatTime()'s strftime-based path doesn't support %f
        # (microseconds) — that's a datetime-only directive, not
        # time.strftime's — so build the timestamp from record.created
        # directly instead of leaving a literal, unsubstituted ".%f"
        # in every line.
        timestamp = datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds")
        payload: dict[str, Any] = {
            "timestamp": timestamp,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "correlation_id": getattr(record, "correlation_id", None),
            "case_id": getattr(record, "case_id", None),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        # Any structured extra=... fields a call site passed, beyond
        # the standard LogRecord attributes.
        for key, value in record.__dict__.items():
            if key not in _RESERVED_LOG_RECORD_ATTRS and key not in payload:
                payload[key] = value
        return json.dumps(payload, default=str)


_configured = False


def configure_logging() -> None:
    """Idempotent — safe to call from both the FastAPI app's import
    and the Temporal worker's entrypoint without double-registering
    handlers."""
    global _configured
    if _configured:
        return
    _configured = True

    log_dir = Path(settings.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / settings.log_file_name

    root = logging.getLogger()
    root.setLevel(settings.log_level)

    context_filter = _ContextFilter()

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-8s %(name)s [%(correlation_id)s] %(message)s", datefmt="%H:%M:%S")
    )
    console_handler.addFilter(context_filter)
    root.addHandler(console_handler)

    file_handler = logging.handlers.RotatingFileHandler(
        log_path,
        maxBytes=10 * 1024 * 1024,  # 10MB per file
        backupCount=5,  # ~50MB retained, rotated oldest-first — matches app-api's winston config
    )
    file_handler.setFormatter(_JsonFormatter())
    file_handler.addFilter(context_filter)
    root.addHandler(file_handler)

    # uvicorn's own loggers otherwise bypass this setup entirely.
    for uvicorn_logger in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        logging.getLogger(uvicorn_logger).handlers = []
        logging.getLogger(uvicorn_logger).propagate = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
