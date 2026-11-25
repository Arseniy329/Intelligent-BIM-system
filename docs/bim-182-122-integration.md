# BIM-182 + BIM-122 local integration

Date: 2026-11-25. Target: `feature/BIM-182-zones-exits` at `258fa49`.
Source: `feature/BIM-122-device-overlay` at `91584e6`; retained as backup.
Both tips matched the supplied revisions; working tree was clean. Common ancestor:
`3ef7714`. A normal two-parent merge preserves all existing commits without squash,
reset, cherry-pick duplication or additional branches.

## Conflict resolution

Nine conflicted files were resolved by combining behavior:

- `drawing-viewer.tsx`, `drawing-canvas.tsx`: forward zones, exits and rules together;
  retain draft filtering, layer filtering and the device legend.
- `drawing-overlay.tsx`: retain zone geometry/height labels, exit markers and label
  visibility alongside original device symbols, exact-id rule states and tooltips.
- `drawing-detail.tsx`: keep independent features/rules queries and error recovery,
  pass both into the viewer; retain zone table editing, feature panels, responsive
  sidebar and rule inspector.
- `drawing-viewer.module.css`, `drawing-workspace.module.css`: retain both sets of
  zone, legend, rule badge and inspector styles, without duplicating shared rules.
- `plan-edit-overlay.tsx`: preserve polygon/zone vertices and circular exit marker;
  device drafts use the original SVG image in the rectangular selection frame.
- `plan-editor-panel.tsx`: keep zone/exit forms, wheel-safe heights, delete recovery
  and draft guards together with the device provenance panel.
- `public/design/bim-107/SOURCES.txt`: retain full original-asset attribution.

Existing BIM-122 ruleId contracts/API serialization are inherited unchanged. No
new backend implementation, migration, database action or production access.

## Checks

- All 353 web tests PASS, including zone creation/editing, exit drafts/recovery,
  device status/legend, viewer lifecycle and guarded navigation coverage.
- All 92 contract tests PASS.
- Lint, standalone TypeScript and production build PASS.
- `git diff --check` PASS; no unresolved conflict markers.
- Native Chrome representative-data preview: simultaneous zones and device symbols;
  smoke/manual/sounder plus heat, counted legend, question-mark review inspector,
  verified and unknown rule selections; hiding smoke leaves other markers visible.
- Zone B table edit to 4.5m updates table, card and overlay. Missing-exit warning
  visible initially; loaded automatic EXITS fixture renders with automatic source;
  manually selected point saves and renders alongside it. Zoom 125%, fit 100% work.

Browser used production components and an explicitly in-memory adapter, not a
backend. Automatic exit recognition itself and database persistence were not tested.
Temporary preview removed and original route restored before merge commit. Screenshots
were captured in the conversation; ignored harness/logs are under `tmp/combined-*`.

## Scope and remaining acceptance limits

Integration is ready as the starting branch for the later full design migration;
that migration has not started. Existing House/Fit asset discrepancy, matching-data
pixel acceptance and official BIM-170 acceptance remain as documented in both task
reports. Backend integration remains deferred by the user until later. These are
not unresolved Git merge conflicts or blockers to starting frontend design work.

No push, merge into dev, branch deletion or Jira changes. The standalone task reports
describe their pre-integration audits; this report records the combined validation.
