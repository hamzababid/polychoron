-- specs/suites/bfsi/features/aml-detection/screens/04-filing-console.md
-- acceptance criterion: "Override of the agent's typology tag is
-- logged (who, what it was changed to, when)". This is a human-edit
-- audit trail, distinct from platform_agent_activity_log (which is
-- exclusively agent invocations, per constitution rule 3) — mixing
-- human edits into that table would blur an agent-vs-human boundary
-- the constitution treats as structural (rule 2).
-- Owned (writes) by app-api, same as aml_str_filings.

CREATE TABLE aml_filing_edits (
    edit_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id      UUID NOT NULL REFERENCES aml_cases (case_id),
    officer_id   TEXT NOT NULL REFERENCES platform_users (user_id),
    field_name   TEXT NOT NULL,
    old_value    TEXT,
    new_value    TEXT,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX aml_filing_edits_case_idx ON aml_filing_edits (case_id);
