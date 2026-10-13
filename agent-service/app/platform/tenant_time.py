"""Tenant-local time for anything a person reads, including what the
agents write. specs/platform/02-platform-data-models.py::Tenant.timezone.

Storage is UTC. A prompt that shows the model raw UTC timestamps gets
UTC clock times back in its narrative, while the screens show the
tenant's local time — so evidence goes into prompts already converted,
with the offset written out and the zone named once.
"""

from __future__ import annotations

import re
from datetime import datetime
from functools import lru_cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text

from app.db import get_connection

UTC = ZoneInfo("UTC")
_ISO_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


@lru_cache(maxsize=64)
def tenant_timezone(tenant_id: str) -> ZoneInfo:
    """The tenant's zone; UTC when the tenant or its zone is unknown."""
    with get_connection() as conn:
        name = conn.execute(text("SELECT timezone FROM tenants WHERE tenant_id = :id"), {"id": tenant_id}).scalar()
    try:
        return ZoneInfo(name) if name else UTC
    except ZoneInfoNotFoundError:
        return UTC


def localize_timestamps(value: Any, tz: ZoneInfo) -> Any:
    """Rewrites every ISO-8601 instant in a JSON-shaped value into `tz`,
    offset included ("2026-09-14T05:00:00Z" → "2026-09-14T10:00:00+05:00").
    Dates without a time and every other string pass through unchanged."""
    if isinstance(value, dict):
        return {k: localize_timestamps(v, tz) for k, v in value.items()}
    if isinstance(value, list):
        return [localize_timestamps(v, tz) for v in value]
    if isinstance(value, str) and _ISO_INSTANT.match(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(tz).isoformat()
    return value


def zone_note(tz: ZoneInfo) -> str:
    offset = datetime.now(tz).strftime("%z")
    return f"All times are local to {tz.key} (UTC{offset[:3]}:{offset[3:]}); quote them as given."
