"""Resets the AML Detection demo data to a clean slate, then re-seeds
it, so the running app matches exactly what
phase-1-aml-core/demo-script.md's "Setup" section expects: both
scenario alerts freshly sitting in the Alert Queue (OPEN, unclaimed,
agent chain already run to completion) when the live walkthrough
starts.

Deletes AML case data only (child tables first, to respect foreign
keys) — leaves the platform registry (Suite/Feature/Tenant/
TenantInferenceProfile) and demo users alone, then re-seeds:
1. The prior cleared case + demo analyst user (seed_aml_demo_data.py)
2. Both scenario alerts, run through the real agent chain
   (inject_demo_alert.py) — this makes real OpenAI calls.

Usage:
    python scripts/reset_demo_environment.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text

from app.db import get_connection

_DELETE_IN_ORDER = [
    "aml_filing_edits",
    "aml_fmu_followups",
    "aml_str_filings",
    "aml_dispositions",
    "aml_case_assessments",
    "aml_typology_matches",
    "aml_evidence_bundles",
    "aml_cases",
]


def clear_aml_data() -> None:
    with get_connection() as conn:
        # aml_fmu_followups references aml_str_filings by filing_id,
        # not case_id — delete it before the filings it points at.
        conn.execute(text("DELETE FROM aml_fmu_followups"))
        for table in _DELETE_IN_ORDER:
            if table == "aml_fmu_followups":
                continue
            conn.execute(text(f"DELETE FROM {table}"))
        conn.execute(text("DELETE FROM platform_agent_activity_log WHERE feature_code = 'aml_detection'"))
        conn.commit()
    print("Cleared existing AML case data.", flush=True)


def main() -> None:
    clear_aml_data()

    script_dir = Path(__file__).parent
    python = sys.executable

    subprocess.run([python, str(script_dir / "seed_aml_demo_data.py")], check=True)
    subprocess.run([python, str(script_dir / "inject_demo_alert.py")], check=True)

    print("\nDemo environment reset. Both scenarios are processing through the agent chain —")
    print("give it ~15-20s (real LLM calls) before they show risk scores in the Alert Queue.")


if __name__ == "__main__":
    main()
