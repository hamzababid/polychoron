# Phase 1 — Demo Script
### This is what "done" means for Phase 1. Run this live, start to finish, before considering the MVP investor-ready.

## Setup (before the live demo starts)
1. Seed data loaded (both scenarios from `mock-bank-integration-spec.md`)
2. Two demo logins ready: one `analyst` role, one `compliance_officer` role
3. Both scenario alerts injected so they're sitting in the Alert Queue
   when the demo starts

## Live walkthrough

**1. Dashboard (30 seconds)**
Log in as compliance officer. Show the Dashboard — open alerts, a
couple of stat tiles. Doesn't need to be data-rich for Phase 1, just
needs to not be empty/broken.

**2. Alert Queue (1 minute)**
Switch to analyst login. Show both seeded alerts in the queue — risk
scores, typology tags, agent recommendations visibly different between
the two ("Recommend STR" vs. "Escalate"). Claim the structuring case.

**3. Case Workspace — positive flow (2-3 minutes)**
Walk through the evidence panel (transaction timeline, linked entity),
the agent's typology reasoning (labeled AI-drafted), add an officer
note, select "File STR."

**4. Filing Console (1-2 minutes)**
Show the pre-populated STR-F fields, the amber attestation panel —
demonstrate the submit button is disabled until attestation is
complete, complete it, submit.

**5. goAML Tracker (30 seconds)**
Show the filing at "Submitted," then (if timed right, or via the demo
trigger button) show it flip to "Acknowledged."

**6. Case Workspace — negative flow (1-2 minutes)**
Switch back to the second seeded case (high-velocity/seasonal). Show
the agent's lower-confidence "Escalate" recommendation, walk through
clearing it with a documented reason, show that this path never touches
Filing Console at all.

## What must not happen during this demo
- No error states, loading spinners that hang, or broken navigation
  between any of these six steps
- No visible reference to mock/fake integration points in the UI itself
  (the mocking is an implementation detail, not something the demo
  narrates)
- No auto-filing anywhere — the attestation gate must visibly matter,
  not just exist
