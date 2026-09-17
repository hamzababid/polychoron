"""Runs the Temporal worker that executes AmlDetectionWorkflow and its
activities. This is a separate process from the FastAPI app
(app/main.py) — the worker polls Temporal's task queue continuously, it
doesn't serve HTTP. The mock-bank FastAPI app must also be running
separately (see app/main.py) since evidence_gathering_activity calls it
over real HTTP.

Usage:
    python -m app.features.aml_detection.worker
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from temporalio.client import Client
from temporalio.worker import Worker

from app.config import settings
from app.features.aml_detection.activities import ALL_ACTIVITIES
from app.features.aml_detection.workflows import AmlDetectionWorkflow

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def run_worker() -> None:
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    # Activities are plain sync functions (our DB/HTTP code is
    # synchronous) — Temporal's Python SDK runs those in a thread pool
    # rather than the workflow's asyncio event loop.
    with ThreadPoolExecutor(max_workers=8) as activity_executor:
        worker = Worker(
            client,
            task_queue=settings.temporal_task_queue,
            workflows=[AmlDetectionWorkflow],
            activities=ALL_ACTIVITIES,
            activity_executor=activity_executor,
        )
        logger.info(
            "AML Detection worker polling task_queue=%s at %s",
            settings.temporal_task_queue,
            settings.temporal_address,
        )
        await worker.run()


if __name__ == "__main__":
    asyncio.run(run_worker())
