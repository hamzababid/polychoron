#!/bin/sh
# Rebuilds the capture dataset: clean demo reset, synthetic volume,
# six months of sampling reviews, clean fictitious names, one
# evidence-incomplete case. Undo with a plain reset_demo_environment.py.
set -e
D="docker exec -e TEMPORAL_ADDRESS=temporal:7233 -e APP_API_BASE_URL=http://app-api:3000 -w /app polychoron-agent-service-api"
Q="docker exec -i polychoron-postgres psql -U polychoron -d polychoron -v ON_ERROR_STOP=1 -q"
$D python scripts/reset_demo_environment.py | grep Injected
until [ "$(docker exec polychoron-postgres psql -U polychoron -d polychoron -Atc "select count(*) from aml_case_assessments")" = "2" ]; do sleep 3; done
$D python scripts/seed_bulk_demo_data.py --count 1800 | tail -1
$Q < "$(dirname "$0")/prep.sql"
docker exec polychoron-postgres psql -U polychoron -d polychoron -Atc "select c.case_id from aml_evidence_bundles e join aml_cases c using(case_id) where e.evidence_incomplete" > "$(dirname "$0")/incomplete_case.txt"
echo prepared
