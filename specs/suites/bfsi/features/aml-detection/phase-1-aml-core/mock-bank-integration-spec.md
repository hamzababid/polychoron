# Phase 1 — Mock Bank Integration Spec

## Purpose
Phase 1 must run without a real bank connection. Build a **mock bank
API service** that stands in for the two integration points the
Evidence Gathering Agent calls: core banking (transaction history) and
KYC.

## Mock service endpoints (implement as a small internal service, not
## a set of hardcoded strings inside the agent — it should be called
## over HTTP exactly like a real integration would be, so swapping it
## for Phase 3's real adapter is a config change, not a rewrite)

- `GET /mock-bank/kyc/{customer_id}` → returns `KYCSnapshot`
- `GET /mock-bank/transactions/{customer_id}?days_back=30` → returns
  `list[TransactionRecord]`
- `GET /mock-bank/linked-entities/{customer_id}` → returns
  `list[LinkedEntity]`

## Seed dataset requirements
Populate the mock service with at least these two scenarios (matching
the ones already designed in the product spec, renamed generically —
do not use real names resembling real individuals):

**Scenario A — structuring, ends in STR filing:**
- Customer: fictional shopkeeper, declared monthly turnover far below
  actual deposit volume
- Three cash deposits just under the CTR threshold, clustered within a
  few hours, across two branches
- One linked account (family member, same address)
- One prior, unrelated, already-cleared alert on file

**Scenario B — high-velocity account, cleared (no suspicion):**
- Customer: fictional wholesale trader, cash-intensive declared business
- Deposit pattern shift starting ~10 days before the "current" demo
  date, plausible seasonal explanation
- No linked entities of concern
- Clean screening history

## Alert injection
Build a simple script (`scripts/inject_demo_alert.py` or similar) that
posts an `InboundAlert` to `POST /api/v1/features/aml_detection/alerts/ingest` for each
scenario, simulating what a real bank's TMS webhook would send. This is
what triggers the agent chain during the live demo.

## goAML mock
The Filing Console's submit action should call a `mock_goaml_submit()`
function that:
1. Returns a fake `goaml_reference` immediately
2. Sets `submission_status = SUBMITTED`
3. After a short delay (simulate via a background job, e.g. 30-60
   seconds later, or an manual "simulate acknowledgment" demo button),
   updates status to `ACKNOWLEDGED`

This lets the demo show the full lifecycle including the status
stepper progressing, without needing a real FMU connection.
