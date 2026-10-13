DELETE FROM aml_sampling_reviews;
WITH plan(m, n, agreed) AS (VALUES (5,25,24),(4,23,22),(3,24,23),(2,22,21),(1,21,20),(0,19,18)),
slots AS (SELECT p.m, g.i, (g.i <= p.agreed) AS ok, row_number() OVER (ORDER BY p.m DESC, g.i) AS rn
          FROM plan p, generate_series(1, p.n) g(i)),
cases AS (SELECT c.case_id, d.disposition_type, row_number() OVER (ORDER BY c.created_at) AS rn
          FROM aml_cases c JOIN aml_dispositions d USING (case_id) WHERE c.status = 'cleared')
INSERT INTO aml_sampling_reviews (review_id, case_id, original_disposition, reviewer_id, reviewer_agreed, reviewer_notes, reviewed_at)
SELECT gen_random_uuid(), cases.case_id, cases.disposition_type, 'demo-mlro-1', s.ok,
       CASE WHEN s.ok THEN 'Clearance supported by the evidence on file.' ELSE 'Would have escalated: pattern warrants senior review.' END,
       date_trunc('month', now()) - make_interval(months => s.m) + make_interval(days => (s.i * 2) % 26, hours => 10 + s.i % 6)
FROM slots s JOIN cases ON cases.rn = s.rn;

CREATE OR REPLACE FUNCTION pg_temp.vc(t text) RETURNS text LANGUAGE sql AS $$
SELECT regexp_replace(regexp_replace(
 replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(t,
  'TMS-ALERT-DEMO-A-PRIOR','TMS-26-011907'), 'TMS-ALERT-DEMO-A','TMS-26-092841'), 'TMS-ALERT-DEMO-B','TMS-26-092857'),
  'ACC-CUST-SEED-BULK-','ACC-3100-'), 'CUST-SEED-BULK-','CUST-3310'), 'SEED-BULK-','TMS-26-08'), 'TXN-SEED-','TXN-'),
  'ACC-DEMO-A1001','ACC-0014-2231'), 'ACC-DEMO-A2001','ACC-0014-2297'), 'ACC-DEMO-B1001','ACC-0027-5184'),
  'CUST-DEMO-A1','CUST-118204'), 'CUST-DEMO-A2','CUST-118209'), 'CUST-DEMO-B1','CUST-204417'),
  'CoreTMS-DemoBank','CoreTMS'), ' (Demo Customer)',''), ' (Demo Address)',''), ' (demo data)',''),
  '11111-1111111-1','42101-5839217-3'), '22222-2222222-2','42201-7730915-8'),
 '00(\d{3})-0000(\d{3})-(\d)', '35\1-48\209-\3', 'g'), 'GOAML-DEMO-', 'GOAML-', 'g')
$$;
UPDATE platform_users SET display_name = regexp_replace(display_name, ' \(Demo [^)]*\)', '');
UPDATE aml_cases SET alert = pg_temp.vc(alert::text)::jsonb;
UPDATE aml_case_assessments SET draft_narrative = pg_temp.vc(draft_narrative), str_fields_draft = pg_temp.vc(str_fields_draft::text)::jsonb;
UPDATE aml_evidence_bundles SET kyc = pg_temp.vc(kyc::text)::jsonb, transaction_timeline = pg_temp.vc(transaction_timeline::text)::jsonb,
  linked_entities = pg_temp.vc(linked_entities::text)::jsonb, prior_cases = pg_temp.vc(prior_cases::text)::jsonb,
  screening_results = pg_temp.vc(screening_results::text)::jsonb, data_gaps = pg_temp.vc(data_gaps::text)::jsonb;
UPDATE aml_typology_matches SET matched_indicators = pg_temp.vc(matched_indicators::text)::jsonb, plain_language_rationale = pg_temp.vc(plain_language_rationale);
UPDATE aml_dispositions SET officer_notes = pg_temp.vc(officer_notes);
UPDATE aml_str_filings SET payload = pg_temp.vc(payload::text)::jsonb, final_narrative = pg_temp.vc(final_narrative), goaml_reference = pg_temp.vc(goaml_reference);

UPDATE aml_evidence_bundles e SET evidence_incomplete = true,
  data_gaps = '["Sanctions & PEP screening: provider did not respond within the time limit", "Prior-case history: not retrieved"]'::jsonb
WHERE case_id = (SELECT c.case_id FROM aml_cases c JOIN aml_case_assessments a USING (case_id)
                 WHERE c.status = 'open' AND c.alert->>'source_alert_id' LIKE 'TMS-26-08%' ORDER BY a.risk_score DESC LIMIT 1);

-- Synthetic cases are dated relative to mid-September; bring them up to
-- the capture date (newest just before now) so the queue shows a
-- realistic fresh/overdue mix.
WITH shift AS (SELECT (now() - interval '40 minutes') - max(created_at) AS d FROM aml_cases WHERE alert->>'source_alert_id' LIKE 'TMS-26-08%')
UPDATE aml_cases SET created_at = created_at + shift.d,
  alert = jsonb_set(alert, '{received_at}', to_jsonb(((alert->>'received_at')::timestamptz + shift.d)::text))
FROM shift WHERE alert->>'source_alert_id' LIKE 'TMS-26-08%';
