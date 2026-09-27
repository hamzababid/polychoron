-- specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md
-- ("Recording FMU feedback"). The goAML Tracker's third step,
-- feedback_received, existed in the status enum but nothing could set
-- it; an officer now records the FMU's feedback, and this is when.
ALTER TABLE aml_str_filings ADD COLUMN feedback_received_at TIMESTAMPTZ;
