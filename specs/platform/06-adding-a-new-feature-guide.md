# Guide: Adding a New Feature (e.g., a hypothetical Fraud Detection feature under BFSI)
### Follow this checklist when the platform grows its second agentic use case. AML Detection is the reference implementation to copy the shape of — not to copy the AML-specific content of.

## 1. Scope and constitution
- [ ] Write a one-page feature overview (purpose, who uses it, what
      decision it ultimately gates)
- [ ] Write a `constitution-addendum.md` if the feature has rules
      beyond the platform constitution (AML's is the reference example)
- [ ] Confirm none of the new feature's rules conflict with
      `platform/00-constitution.md` — addenda can only add stricter
      rules, never relax platform ones

## 2. Data model
- [ ] Define the feature's own Pydantic models in
      `suites/<suite>/features/<feature-name>/data-models.py`
- [ ] Every case-like entity writes a `FeatureCaseEnvelope` (platform
      model) alongside its own record, so cross-feature visibility
      works without extra migration work later

## 3. Agent chain
- [ ] Implement node(s) against the `PlatformAgentNode` contract
      (`platform/03-agent-framework-spec.md`)
- [ ] Wire them into a Temporal workflow, following the same
      deterministic-graph pattern as AML's implementation
- [ ] Confirm every node writes a `PlatformAgentActivityLogEntry`
      tagged with the new `feature_code`

## 4. Role manifest
- [ ] Write `role-manifest.md`, namespacing every role with the new
      `feature_code` (e.g. `fraud_detection.analyst_l1`)
- [ ] Register the manifest with platform RBAC — do not build a
      separate auth mechanism

## 5. API & screens
- [ ] Write the feature's own API contract file, following the same
      structure as AML's `phase-1-aml-core/api-contracts-phase1.md`
- [ ] Write one screen spec per screen, following the same template as
      AML's screen specs (purpose, data binding, states, RBAC,
      acceptance criteria)
- [ ] Register the feature in the navigation shell's feature switcher

## 6. Registration
- [ ] Add a `Feature` record (platform data model) for the new feature,
      referencing its role manifest and setting `status = "planned"`
      until it's demo-ready, then `"beta"` or `"ga"`
- [ ] Confirm the platform's event-routing layer can dispatch the new
      feature's trigger events to its workflow without any change to
      platform-level routing code — if it can't, the platform
      abstraction has leaked (see constitution rule 9) and needs fixing
      before the feature ships

## 7. Phase plan
- [ ] Write the feature's own MVP phase breakdown — it does not need to
      match AML's phase timeline or scope, but should follow the same
      "MVP core → full feature set → enterprise hardening" shape if the
      feature is being demoed to anyone external
