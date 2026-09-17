"""Minimal, dependency-light migration runner for the shared `polychoron`
Postgres database.

This is the single source of truth for schema shared by app-api
(NestJS) and agent-service (FastAPI) per
specs/platform/09-backend-service-boundary-spec.md ("shared Postgres,
table-level ownership"). Neither service's ORM (TypeORM / SQLAlchemy)
owns schema migrations — both map onto tables this script creates.

Usage:
    python infra/db/migrate.py            # apply all pending migrations
    python infra/db/migrate.py --status   # list applied/pending, don't apply
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2

MIGRATIONS_DIR = Path(__file__).parent / "migrations"

DEFAULT_DATABASE_URL = (
    "postgresql://polychoron:polychoron_dev_only@localhost:5432/polychoron"
)


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def ensure_migrations_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename    TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def applied_migrations(cur) -> set[str]:
    cur.execute("SELECT filename FROM schema_migrations")
    return {row[0] for row in cur.fetchall()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true", help="Show status only, apply nothing")
    args = parser.parse_args()

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        print(f"No migration files found in {MIGRATIONS_DIR}")
        return 1

    conn = psycopg2.connect(get_database_url())
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            ensure_migrations_table(cur)
            conn.commit()
            applied = applied_migrations(cur)

        pending = [f for f in migration_files if f.name not in applied]

        if args.status:
            for f in migration_files:
                mark = "applied" if f.name in applied else "pending"
                print(f"[{mark}] {f.name}")
            return 0

        if not pending:
            print("Nothing to apply — schema is up to date.")
            return 0

        for f in pending:
            print(f"Applying {f.name} ...")
            sql = f.read_text(encoding="utf-8")
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename) VALUES (%s)", (f.name,)
                )
            conn.commit()
            print(f"  OK: {f.name}")

        print(f"Applied {len(pending)} migration(s).")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
