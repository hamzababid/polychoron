"""Seeds AML Detection's golden dataset (12 cases) into
platform_golden_dataset_cases. Idempotent — safe to re-run (the
repository layer upserts on (feature_code, scenario_name)). Run before
the first golden-dataset regression:

    python scripts/seed_golden_dataset.py

specs/suites/bfsi/features/aml-detection/golden-dataset-and-fairness-spec.md
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.features.aml_detection.golden_dataset import seed_golden_dataset


def main() -> None:
    count = seed_golden_dataset()
    print(f"Seeded {count} golden dataset case(s).")


if __name__ == "__main__":
    main()
