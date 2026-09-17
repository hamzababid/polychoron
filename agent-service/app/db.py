"""Shared Postgres connectivity. Schema is owned by
infra/db/migrations/*.sql, not by any ORM here — see
specs/platform/09-backend-service-boundary-spec.md ("shared Postgres,
table-level ownership"). SQLAlchemy Core (not the ORM layer) is used
throughout so table access stays a thin, explicit mapping onto that
shared schema rather than a second source of schema truth."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Connection, create_engine

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)


@contextmanager
def get_connection() -> Iterator[Connection]:
    with engine.connect() as conn:
        yield conn
