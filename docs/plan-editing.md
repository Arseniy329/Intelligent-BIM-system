# BIM-164 / BIM-80: editing the plan

Depends on BIM-120 (PR #39, merged into dev). Shared Supabase was verified on
2026-11-15: migration 006's nullable rule_id was already present; migration 007
was applied with owner approval and its nullable numeric/positive constraint
verified. The application does not automatically apply migrations.

The plan and rooms table share the selected room. Select an outline or use the
room selector, then change its vertices, confirm it, or request deletion.
New rooms are drawn by clicking corners and entering a name. Existing outline
changes are saved unconfirmed so the engineer reviews the new geometry before
placement. Creation retains BIM-120's existing contract: manually drawn rooms
are confirmed when saved. Type and height remain editable in the rooms table.

Device editing is available for processed drawings. Choose a device and move
it, or choose a type and click to add a device. Dragging and keyboard arrow
movement use the viewer's inverse coordinate transform; Shift increases the
keyboard step. The containing room is recomputed when the position is saved.
An outside position is stored with no room assignment.

Only one item is drafted at a time. Save submits one request; cancel discards
the draft. Delete requires explicit confirmation. Placement, reprocessing,
tab changes and result downloads are disabled while an edit is pending.
Successful mutations refresh the complete drawing, rooms, devices and signed
download URL. The current drawing API does not expose calculated violations;
this feature does not claim that manually moved devices comply with norms.

An ambiguous write failure locks further edits until data is refreshed, so a
committed POST is not automatically replayed. Failed DXF regeneration leaves
the saved devices intact, marks the export stale and hides its download URL.
`POST /drawings/{id}/devices/regenerate` retries export without another mutation;
it checks ownership and the processed state. Existing signed URLs already
issued to a client are not revoked by this marker.

## Validation

- API: 191 unittest cases, Ruff and mypy.
- Web: 309 Vitest cases, including 11 editor scenarios and two DrawingDetail
  integration regressions; contracts: 91 cases.
- Contract generation, lint, TypeScript and production build.
- Isolated Chromium with the real DXF renderer and an in-memory editing API:
  pointer drag/cancel, device type/add/save/delete, 390px viewport, no runtime
  errors. This is not a live Supabase or hosting acceptance test.

## Entry points while plan editing is blocked

`editor.blocked` includes a draft, pending deletion, saving, and uncertain writes.

| Entry point | Protection |
| --- | --- |
| Four tabs and placement banner | Disabled controls plus shared navigation guard |
| Rooms table return to plan | Same navigation guard |
| Upload another drawing link | Prevents navigation while blocked |
| Process/reprocess button and previously opened confirmation | Disabled and handler checks against current editor state |
| Result download | Disabled and handler guard |
| File refresh and viewer retry | Shared handler guard |
| Placement and export recovery | Disabled while blocked |

Integration tests render the real page and editor hooks: banner clicks preserve
access to save/cancel, and opening reprocess confirmation before drafting cannot
invoke processDrawing until cancellation. These tests use an in-memory API.

## Hosted acceptance after database verification and approved merge

1. Process a test DXF. Confirm that automatic room recognition still works.
2. Select a room on the plan, then open the rooms tab and verify the selection.
3. Drag a vertex, cancel, then repeat and save. Reopen and check the area.
4. Draw and name a room, save it, then delete it through the confirmation.
5. Confirm one/all outlines. Placement must remain blocked for unconfirmed or
   incomplete room data.
6. Place devices; move, add each supported type, and delete a device. Download
   the result DXF and inspect the matching blocks/positions in a CAD viewer.
7. In an isolated test environment, simulate an export failure; confirm that
   the old download is hidden and retry creates the correct DXF without
   duplicating a device.

Concurrent edits by multiple users are not transactional across PostgreSQL
and Storage. A cross-service transaction/version-lock design is outside this
change; test acceptance uses one editor at a time.
