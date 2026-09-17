"""Phase 1 stand-in for the Typology & Rules Console (explicitly Phase 2
scope — specs/suites/bfsi/features/aml-detection/mvp-phases.md). The
Pattern Matching Agent's tool allowlist is "typology config lookup
only" (agent-implementation.md); for Phase 1 that lookup resolves to
this fixed, in-repo catalog rather than a database-backed, versioned,
analyst-editable rule set. Swapping this for the real Typology Console
in Phase 2 changes where these definitions are read from, not how the
Pattern Matching Agent consumes them.
"""

from __future__ import annotations

# A fictional demo constant, not an assertion of the real regulatory
# CTR threshold (see mock_bank/seed_data.py's module docstring) — the
# Pattern Matching Agent needs *some* concrete threshold to recognize
# "sub-threshold" deposits against.
DEMO_CASH_REPORTING_THRESHOLD_PKR = 2_000_000

TYPOLOGY_CATALOG: list[dict[str, str]] = [
    {
        "typology_code": "structuring_subthreshold",
        "typology_label": "Structuring — sub-threshold cash deposits",
        "description": (
            f"Multiple cash deposits, each individually below the "
            f"PKR {DEMO_CASH_REPORTING_THRESHOLD_PKR:,} cash reporting threshold, "
            "clustered tightly in time (within hours of each other, same day) "
            "and/or split across branches — a pattern consistent with "
            "deliberately avoiding a single reportable transaction — where the "
            "aggregate amount substantially exceeds what the customer's "
            "declared occupation/turnover would explain."
        ),
    },
    {
        "typology_code": "deposit_velocity_shift",
        "typology_label": "Deposit velocity shift — unexplained increase in cash activity",
        "description": (
            "A gradual step-change increase in cash deposit frequency or "
            "volume over days to weeks (not same-day clustering, and not "
            "obviously threshold-avoidant), relative to the customer's prior "
            "pattern, which may have an innocuous business explanation (e.g. "
            "seasonal stocking) but warrants human judgment rather than an "
            "automatic clear."
        ),
    },
]


def catalog_as_prompt_block() -> str:
    lines = [
        (
            f"Cash reporting threshold for this exercise: PKR {DEMO_CASH_REPORTING_THRESHOLD_PKR:,} "
            "per transaction (a fictional demo constant)."
        ),
        "Active typology catalog (Phase 1):",
    ]
    for t in TYPOLOGY_CATALOG:
        lines.append(f"- {t['typology_code']} ({t['typology_label']}): {t['description']}")
    return "\n".join(lines)
