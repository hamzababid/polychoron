"""Phase 1 demo constant retained for Phase 2. The typology catalog
itself moved to the real, DB-backed Typology & Rules Console
(aml_typology_configs, owned by app-api) — see
typology_config_repository.py, which the Pattern Matching Agent now
reads from instead of a hardcoded list here. This module keeps only
the demo threshold value both the original seed data
(mock_bank/seed_data.py) and the migrated typology descriptions were
written against.
"""

from __future__ import annotations

# A fictional demo constant, not an assertion of the real regulatory
# CTR threshold (see mock_bank/seed_data.py's module docstring) — the
# Pattern Matching Agent needs *some* concrete threshold to recognize
# "sub-threshold" deposits against.
DEMO_CASH_REPORTING_THRESHOLD_PKR = 2_000_000
