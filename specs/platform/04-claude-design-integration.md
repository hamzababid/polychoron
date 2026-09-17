# Polychoron AI — Claude Design Integration Guide

## What you should do before starting any screen's implementation
For each screen you've already generated in Claude Design, export it
and place it under `design-exports/<suite>/<feature>/`, named to
exactly match the "Claude Design reference file" field at the top of
that screen's spec — e.g. AML Detection's Case Workspace export goes to
`design-exports/bfsi/aml-detection/case-workspace.html`. Platform-level
screens (like Admin & Access Control) go directly under
`design-exports/platform/`.

## Division of responsibility between the Design export and the spec
- **The Claude Design export is the visual source of truth**: layout,
  spacing, color, typography, component styling.
- **The spec file is the behavioral source of truth**: what data binds
  to what element, what API calls fire on what interaction, what states
  exist (loading/empty/error), what the RBAC/phase constraints are, and
  the acceptance criteria.
- When the two seem to conflict (e.g., the Design export shows a button
  that the spec says shouldn't exist yet in Phase 1), **the spec wins**
  for phase-gating decisions, and the visual should be adapted or
  hidden behind a feature flag rather than removed from the design
  system entirely.

## Instruction to give Claude Code per screen
When starting a screen's implementation, the prompt pattern should be:

```
Implement the [Screen Name] screen.
- Spec: specs/screens/[NN-screen-name].md
- Visual reference: design-exports/[screen-name].[ext]
- Data models: specs/02-data-models.py
- Reuse existing components from screens already built in this phase
  before creating new ones — check the component library first.
Read the spec's acceptance criteria before starting, and verify each
one is met before marking this screen complete.
```

## Component reuse discipline
Several screens deliberately share components (flagged explicitly in
the specs):
- The linked-entity/relationship graph appears on both Case Workspace
  and Customer 360 — implement once, reuse.
- The agent-vs-officer content styling pattern (Case Workspace) and the
  live-vs-draft styling pattern (Typology & Rules Console) are the same
  underlying design token pair applied to two different contexts —
  define the token pair once (e.g. `--content-source-ai` /
  `--content-source-human`) rather than reimplementing per screen.

If your Claude Design exports were generated screen-by-screen (as they
were in this project), the first implementation pass should extract a
shared component library from the first 2-3 screens built, rather than
copy-pasting styled markup forward into every subsequent screen.

## If a Claude Design export doesn't exist yet for a screen
Build against the spec alone using the design tokens established by
whichever screens *do* have exports, so visual consistency holds even
for screens designed later. Do not block implementation on having every
screen's Design export in hand before starting Phase 1 — the four core
Phase 1 screens are the priority to have exports for first.
