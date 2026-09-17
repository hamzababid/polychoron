"""Setup-phase connectivity check: agent-service's Python Temporal
client can reach the same Temporal server app-api's TypeScript client
connects to. Real workflow/worker code is built in the Agent Chain
task — this only proves the connection itself, per TASKS.md's Setup
item "Set up Temporal (local dev instance); confirm both the Python
worker (agent-service) and the TypeScript client (app-api) can reach
it."""

from __future__ import annotations

import pytest
from temporalio.client import Client

from app.config import settings


@pytest.mark.asyncio
async def test_python_client_connects_to_temporal():
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    # A trivial call that round-trips to the server, proving the
    # connection is live rather than merely constructed.
    workflows = client.list_workflows(query="")
    async for _ in workflows:
        break
