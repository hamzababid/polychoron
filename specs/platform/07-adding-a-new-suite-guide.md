# Guide: Adding a New Suite (a new industry vertical, alongside BFSI)
### A suite is mostly organizational, not architectural — most of the real work happens at the feature level (see `06-adding-a-new-feature-guide.md`). This guide is short on purpose.

## 1. Register the suite
- [ ] Add a `Suite` record (platform data model): `suite_code`,
      `suite_name`, `description`
- [ ] Add the suite to the navigation shell's suite switcher

## 2. Decide what, if anything, is suite-specific
Most of what varies across industries lives at the feature level (an
AML Detection feature is BFSI-specific by nature; a hypothetical
Healthcare suite's features would be entirely different agentic use
cases, not a reskinned AML feature). A suite itself typically only
carries:
- Suite-level terminology/branding (e.g. "Officer" vs. a different
  title another industry might use for the equivalent role)
- Which features are available under it

Do not build suite-level business logic — if you find yourself writing
logic that branches on `suite_code`, that logic almost certainly
belongs in a feature instead.

## 3. Add its first feature
A new suite with zero features isn't useful — follow
`06-adding-a-new-feature-guide.md` for the suite's first real feature.
There is no meaningful "suite MVP" separate from "that suite's first
feature's MVP."

## 4. Confirm platform-level code didn't need to change
The test of whether the Suite/Feature architecture is holding up: adding
a new suite should mean adding new directories and registry records,
never editing `platform/` code. If it does require a platform-level
change, treat that the same way constitution rule 9 treats a leaking
feature abstraction — a bug in the architecture, not a one-off
exception.
