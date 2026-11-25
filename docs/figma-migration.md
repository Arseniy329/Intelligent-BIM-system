# Approved Figma frontend migration

2026-11-25. Branch: `feature/BIM-182-zones-exits`. Baseline: `3760eb1`.
This report accompanies the single `feat(ui): migrate application to approved Figma design`
commit. Obtain its full hash with `git log -1 --format=%H` after committing.

## Coverage and reference mapping

| Existing route / state | Reference classification | Result |
| --- | --- | --- |
| `/login` | EXACT REFERENCE: Desktop 1 | MIGRATED — EXACT COMPARISON UNVERIFIED: split story/form layout, original illustration, branding, password visibility, validation preserved |
| `/register` | EXACT REFERENCE: Desktop 2 | MIGRATED — EXACT COMPARISON UNVERIFIED: same auth composition; retained required password confirmation rather than adding unsupported name/terms business logic |
| `/upload` | EXACT REFERENCE: Desktop 3 | MIGRATED — EXACT COMPARISON UNVERIFIED: centered upload card, drop area, shared shell; existing unit selection, 50 MiB limit, explicit upload and retry retained |
| `/drawings` | PARTIAL REFERENCE: Desktop shell, shared table/state library | MIGRATED AND VERIFIED: consistent shell, table, empty/loading/error patterns; removed duplicate page-container padding |
| `/drawings/[id]` | EXACT REFERENCE: Desktop 4–8, 10–19; BIM-129/01–04; BIM-131/01–05 | MIGRATED — EXACT COMPARISON UNVERIFIED: preserves integrated viewer, room/zone/exit panels, original devices, provenance, layers and draft guards; shared tokens and height-field alignment applied |
| `/drawing-preview` | PARTIAL REFERENCE: Desktop 3–6 | MIGRATED AND VERIFIED: existing local preview uses the same shell/tokens and viewer; no auth guard changes |
| `/rules` | PARTIAL REFERENCE: BIM-129/05 and component library | MIGRATED AND VERIFIED: retained global catalog table/filter and normative lookup; shared surfaces/table controls and question-mark review badge |
| `/admin/users` | NO REFERENCE for admin page; approved shared components | MIGRATED AND VERIFIED: shell, table, inputs, dialogs and empty state inherit shared tokens; conservative existing layout and permissions retained |
| `/`, `/admin`, `/auth/callback` | NOT APPLICABLE: redirects/callback | Unchanged functional routes |
| Drawing room table/edit state | EXACT REFERENCE: BIM-129/02–03, BIM-131/04, Desktop 7 | MIGRATED — EXACT COMPARISON UNVERIFIED: flatter cards, semibold heading, shared table; source/confirmation/completeness remain independent |
| Drawing rules/report tabs | PARTIAL REFERENCE: BIM-129/05–06 | PARTIALLY MIGRATED: existing tab shells inherit design; report business logic is absent and was not fabricated |
| Regulatory document management, DXF verification, findings/conflict report | FUTURE FEATURE: BIM-131/06–09, BIM-173 | BLOCKED BY MISSING FUNCTIONALITY: no matching implemented routes/workflows; no fake production screens added |
| Separate project/account/settings pages | NO REFERENCE to implemented route | NOT APPLICABLE: not present in current application; existing account menu/logout retained |

MIGRATED AND VERIFIED means shared visual/component structure and the specified local
checks were verified, not full authenticated acceptance or exact pixel parity.

## Implementation checklist

- [x] Read integration report, confirm ancestry and clean starting tree.
- [x] Reuse first-package renders/inventory and all 51 extracted second-package ZIPs.
- [x] Recursively inventory the design root; search for standalone House/Fit.
- [x] Read developer handoffs: independent room states, review is not a violation,
  illustrative data, and future feature boundaries.
- [x] Inspect Desktop 1–19 and compact BIM-129/131/173 reference sheets.
- [x] Audit every implemented route and shared component; map above.
- [x] Migrate auth, upload, global shell and shared page/state components.
- [x] Preserve integrated BIM-182/BIM-122 and existing backend contracts.
- [x] Run selective headless visual, DOM and interaction checks; remove fixtures.
- [x] Final production checks and review complete; delivery uses one commit only.

## Shared components and tokens

Unified original-logo header/account navigation and footer, 1440px page container
with 40px desktop gutters, 16px mobile gutters; existing destinations retained.
AuthFrame implements the approved 52.2%/47.8% split and 360px form column.
PasswordInput adds the visible reference control without changing authentication.
Upload card uses the approved heading, centered surface and blue chooser; actual
upload limits/unit controls remain functional rather than copying illustrative data.

Shared tokens retain Inter, blue primary and independent status colors. Updated page
surface to #F7F9FC, input/secondary borders to #E2E8F0, large card radius to 12px,
flat card shadow, and table header to 44px. Existing button/input/select/dialog/
badge/skeleton/toast components inherit these tokens; no competing component system.
Tables use the approved light header. Empty states gain a centered minimum-height
surface. Room headings/cards are flattened, rule badges retain a question mark, and
zone height rows explicitly retain their horizontal label/input layout in inspectors.

New asset: `public/design/bim-107/auth-plan.svg`, byte-for-byte standalone Frame 117.svg,
520×357. Used only as the promotional auth illustration, never as the interactive
viewer. Original logo, device/room SVGs, font files and licenses are unchanged.
Attribution updated. No whole-page export is used as a functional UI.

## Verification evidence

Headless Playwright, isolated tooling under ignored `tmp/migration-tools`; external
browser requests blocked. Existing actual page components rendered with explicitly
local fixture data in a temporary route. That route and harness were removed before
the production build. No auth bypass or mock behavior shipped.

- Before: `tmp/migration-evidence/before-{login,register,drawing-preview}.png`.
- After: `after-{login,register,drawing-preview,upload,drawings,rules,rooms,room-edit,admin,error,loading,workspace}.png`.
- Significant states: `login-validation.png`, `admin-dialog.png`.
- DOM results: `measurements.json`, `mobile.json`, `interactions.json` in that folder.
- Before screenshots were not captured for protected component fixtures; no invented
  before/after comparison is claimed for those pages.
- Desktop 1440px: measured 1440px shell and 40px gutters, Inter font, loaded original
  image assets; no horizontal document overflow or page errors on tested pages.
- Mobile 390px: login/register/upload, lists, rules, rooms/edit, admin, errors/loading
  have no document overflow. Wide tables scroll within their own container.
- Password show/hide and local required-email validation PASS.
- Admin dialog opens and Escape dismisses it; visible focus ring inspected.
- Combined workspace: original device symbols, review/verified/unknown panel states,
  zone card save to 4.5m, automatic-exit fixture display, manual exit selection/save,
  smoke layer isolation, zoom to 125% and fit to 100% PASS.
- A stale dev compiler module was detected by DOM measurement; compiler restarted and
  affected measurements/screenshots/interactions repeated against current source.

These checks do not establish automatic exit detection, authenticated writes/reload,
device placement against a real database, or production access. They verify retained
frontend behavior with representative data. Official BIM-170 remains unverified.

## Remaining fidelity and functional boundaries

Exact whole-application pixel acceptance is NOT claimed. House/Fit original assets
remain missing and the explicitly allowed existing substitutes remain. No flattened
paths were extracted/redrawn. Exported reference geometry/device counts differ from
the representative drawing; those differences are not automatically layout defects.
Registration confirmation, upload units/limits and existing operational controls
remain where the static reference omits them. Existing admin/lookup icons are retained
where no approved replacement exists; no new third-party icon set was introduced.

Conflicting workflow details are resolved conservatively: BIM-129 defines semantic
states, BIM-131 specializes zones/exits, Desktop frames define existing viewer editing.
No line-splitting algorithm, regulatory conflict engine or report-generation workflow
was added merely to reproduce a reference. Backend integration remains deferred by
the user; no repeated deployment investigation, migrations or production access.

Manual follow-up: verify real authentication/account flows, authorized upload/retry,
real rules retrieval and admin writes in the test environment; later verify persisted
zones/exits/ruleId after the backend merge. Obtain original House/Fit and matching
Figma drawing/state records for exact visual acceptance; obtain official BIM-170 data.

## PR draft

Title: Migrate existing frontend to approved Figma design

Applies the supplied auth split layout, original illustration and consistent application
shell; aligns upload, shared surfaces, tables and room/rule states while retaining the
combined BIM-182/BIM-122 behavior. Keeps unsupported document/verification/findings
mockups outside production functionality. No API, authorization, database, placement
or DXF geometry changes. Includes original asset attribution and local visual evidence.

Validation: see final command results recorded below. Exact pixel parity, authenticated
backend integration and official BIM-170 acceptance remain explicitly unverified.
No push, dev merge, Jira modification or backup-branch change authorized/performed.

## Final regression results

Executed after removing the temporary preview route and fixing the generated Next
page-props signature check; no functional assertions were removed:

| Command / check | Result |
| --- | --- |
| `npm.cmd test` | PASS: 353 web tests across 33 files; 92 contract tests across 2 files |
| `npm.cmd run lint` | PASS |
| `npm.cmd run typecheck` | PASS: web and contracts |
| `npm.cmd run build` | PASS: production build and all 12 static pages |
| Headless browser checks | PASS for the representative-data interactions and layouts listed above |
| `git diff --check` | PASS |
| Original auth illustration SHA-256 | Matches supplied standalone SVG byte-for-byte |

The integration baseline remains the parent of this migration. BIM-122 backup remains
`91584e67ea28a584b311d984e7b1cd0361be218d`. BIM-182/BIM-122 frontend compatibility
is verified by the unchanged complete test suite and combined workspace browser checks;
real backend acceptance remains deferred. No backend, contracts, dependency manifests,
lockfiles, production configuration or original design exports were changed. Browser
screenshots, tooling and command logs remain in ignored `tmp/`, outside the commit.
