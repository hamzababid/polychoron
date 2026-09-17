# AML Detection — Constitution Addendum
### Feature-specific rules, additional to (never in conflict with) `platform/00-constitution.md`.

## A1. STR-F fields never include a suspicion-rationale field
The agent-fillable `STRFieldsDraft` schema must never gain a field for
"why this is reportable" or a suspicion score presented as a filing
field. This is the feature-specific instance of platform constitution
rule 1 — the schema itself makes it structurally impossible for the
agent to make the legal suspicion determination.

## A2. goAML submission requires the tipping-off checklist
In addition to the platform's general human-attestation rule, AML's
Filing Console specifically requires a completed tipping-off checklist
(no account freeze/closure/customer contact that could alert the
customer) before submission — this is a legal requirement under AMLA
2010's confidentiality provisions, not just a best practice.

## A3. Ten-year retention is computed at submission, not filing-review
`STRFiling.retention_expiry` is set server-side at the moment of
submission (`submitted_at + 10 years`) and is never recalculated
client-side or editable after the fact.

## A4. CTR-to-STR reclassification is always a human act
Recognizing a series of under-threshold cash transactions as
structuring (changing a routine CTR into a suspicious STR) is a
disposition decision requiring the same override/reasoning discipline
as any other human override — never an automatic reclassification.
