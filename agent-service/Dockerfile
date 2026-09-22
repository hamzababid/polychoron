# Dev-mode image — source is bind-mounted at runtime (see
# infra/docker-compose.yml) for hot reload, so this build only needs
# to produce a working environment with dependencies installed. No
# .venv inside the container: the container itself is the isolation
# boundary, so dependencies install straight into the system Python.
FROM python:3.11-slim

WORKDIR /app

# libpq5: psycopg2-binary's runtime dependency on Debian slim images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copied (not yet bind-mounted) so `pip install -e .` has a real
# package to install at build time — the bind mount overlays this
# with live source at container start.
COPY pyproject.toml ./
COPY app ./app
COPY scripts ./scripts

RUN pip install --no-cache-dir -e ".[dev]"

# No default CMD — infra/docker-compose.yml sets a different command
# per service (mock-bank API vs. Temporal worker vs. one-shot
# migrate/seed jobs), all from this same image.
