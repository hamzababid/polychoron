#!/bin/sh
# prep until the scenario A narrative carries no clock times (see TASKS: UTC vs local display)
for n in 1 2 3 4; do
  ./prep.sh > /dev/null 2>&1
  T=$(docker exec polychoron-postgres psql -U polychoron -d polychoron -Atc "select count(*) from aml_cases c join aml_case_assessments a using(case_id) left join aml_typology_matches m using(case_id) where c.alert->>'source_alert_id' in ('TMS-26-092841','TMS-26-092857') and (coalesce(a.draft_narrative,'') || coalesce(m.plain_language_rationale,'') || coalesce(m.matched_indicators::text,'')) ~ '[0-9]{1,2}:[0-9]{2}'")
  echo "attempt $n: narratives with clock times = $T"
  [ "$T" = "0" ] && exit 0
done
exit 1
