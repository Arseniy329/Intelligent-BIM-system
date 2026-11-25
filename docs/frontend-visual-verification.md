# Focused frontend visual verification

2026-11-25 · `feature/BIM-182-zones-exits` · `577c147`

## Outcome

Ready for manual review and draft PR preparation, with minor confirmed auth styling
differences and incomplete authenticated coverage. This is not full design acceptance.
No critical/high functional defect was confirmed in the accessible workflows.
No source edits, commits, branch changes, test-suite reruns or backend operations.

## Method and page results

Reused the running localhost:3000 server, previous design inventory and original
Desktop SVG/PDF renders. Headless Chrome via Playwright; desktop 1440x864, targeted
measurements/interactions at the reference's exact 1440x866, mobile 390x844.
Only localhost browser requests were allowed. No authenticated storage-state fixture
was found in existing temporary artifacts; this isolated browser had no session.
No user browser profile, credentials, accounts or authentication configuration were changed.

| Route | Status | Evidence / limits |
| --- | --- | --- |
| `/login` | PASS WITH MINOR ISSUES | Original split layout, logo, 360x40 inputs; validation, visibility toggle, focus and registration navigation work; differences below |
| `/register` | PASS WITH MINOR ISSUES | Shared layout fits desktop/mobile; confirmation retained; no registration request submitted |
| `/drawing-preview` | PASS | Existing local preview/demo renders and tested interactions work; this is not the full drawing workspace |
| `/upload` | NOT VERIFIED | Server redirects to `/login`, no authenticated session |
| `/drawings` | NOT VERIFIED | Server redirects to `/login`, no authenticated session |
| `/rules` | NOT VERIFIED | Server redirects to `/login`, no authenticated session |
| `/admin/users` | NOT VERIFIED | Client gate ultimately redirects to `/login?redirect=%2Fadmin%2Fusers`; transient redirect message is not an admin-page screenshot |
| `/admin` | NOT VERIFIED | Authentication gate; no administrative content inspected |
| `/` | PASS | Anonymous navigation redirects to login |
| `/drawings/[id]` | NOT VERIFIED | No authenticated drawing available; no invented ID or fake fixture route used |
| `/auth/callback` | NOT VERIFIED | No valid callback code/session; deliberately did not initiate external auth |

## Confirmed discrepancies, prioritized

### 1. LOW — authentication field and button styling

- Routes: `/login`, `/register`; form inputs and primary action.
- Expected: Desktop 1/2 SVG input rectangles have `rx=7.5` on the inset
  359x39 outline (8px outer radius), border `#CBD5E1`, surface `#F8FAFC`.
- Actual: computed input radius 12px, border `rgb(226,232,240)` / `#E2E8F0`;
  page background `#F7F9FC`. Primary buttons also visibly have rounder corners.
- Evidence: `login.png`, `register.png`, `followup.json`; supplied
  `Desktop - 1.svg` and `Desktop - 2.svg` rectangle attributes.
- Likely files: `components/auth/login-form.tsx`, `register-form.tsx`,
  `app/globals.css`, `tokens.json` under the web application/root respectively.
- Correction: use reference auth control radius/border/background values, scoped
  where necessary; avoid changing unrelated specialized component styles blindly.

### 2. LOW — reference form hints and action copy omitted

- Routes: `/login`, `/register`; form inputs/actions/subtitle.
- Expected: Desktop 1/2 show email and password placeholder hints; login action
  includes a trailing arrow. Desktop 2 uses the first-drawing subtitle and
  “Створити обліковий запис” action.
- Actual: email/password placeholders are empty; login action lacks its arrow;
  registration retains previous subtitle and “Зареєструватися” action.
- Evidence: screenshots and `interactions.json` empty placeholder attributes.
- Likely files: `components/auth/login-form.tsx`, `register-form.tsx`,
  `app/(auth)/register/page.tsx`.
- Correction: align reference copy and hints while keeping visible labels,
  validation and password confirmation. Do not add name/newsletter behavior
  merely to reproduce Desktop 2; that documented functional difference is not
  classified here as a regression.

No confirmed responsive overflow at 1440px or 390px on accessible pages. Auth
story hides on mobile; preview toolbar and legend wrap, with no document overflow.
The diagram's different content is not treated as a layout defect. Exact pixel
parity is not established by these checks.

## Interaction evidence

- Login empty submission marks both fields invalid and displays actionable messages.
- Password visibility switches input type; keyboard focus has a 2px blue outline.
- Login-to-registration link reaches `/register` after waiting for navigation.
  The earlier immediate URL sample in `interactions.json` preceded navigation;
  `followup.json` confirms success, not a navigation defect.
- Preview demo loads a 1358x535 desktop canvas and 356x420 mobile canvas.
- Zoom reaches 125%; fit restores 100% at the original desktop size.
- Pan moves the smoke marker exactly 65px horizontally and 35px vertically.
- Label toggle preserves the marker position; device toggle preserves zoom and
  removes/restores markers. Thus these unrelated UI changes preserve camera state.
- Smoke, heat, manual and sounder symbols and corresponding legend are visible.
- Device click opens unknown-rule detail; unknown status stays distinct from
  confirmed violations. The preview fixture supplies no verified/review rules.
- Account menu opens/closes; close drawing removes the canvas.
- No console errors, uncaught page errors or failed requests were recorded in
  the monitored page and interaction runs. This does not test backend reliability.

NOT VERIFIED in this pass: full room selection/editing, confirmation, zone cards,
zone-height editing/table rows, automatic/manual/missing exits, rule provenance
with real rule data, positive verified/review indicators, workspace mode tabs,
table scrolling and disabled/loading backend states. The public preview passes
rooms/devices to DrawingViewer, but does not expose these full-workspace controls.
Previous migration fixture tests are not presented as new evidence here.

## Screenshots and machine-readable evidence

All artifacts are local, ignored and outside production source: `tmp/final-visual/`.

- `login.png`, `register.png`: auth comparison images.
- `drawing-preview.png`: initial local preview.
- `preview-demo.png`: loaded original-symbol demo and legend.
- `preview-selected.png`: selected device/unknown-rule detail.
- `preview-mobile.png`: responsive demo and tooltip.
- `upload.png`, `drawings.png`, `rules.png`, `root.png`: login redirects, not
  screenshots of protected application content.
- `admin-users.png`, `admin.png`: transient auth gate, not admin UI.
- `results.json`, `interactions.json`, `followup.json`: layout, console/network
  and interaction measurements. Screenshots were visually inspected against the
  reused reference renders; 2px viewport-height differences in the first captures
  are not reported as defects.

## Remaining access and review steps

1. Correct the two low-priority auth differences in a separately authorized edit.
2. Provide a signed-in local test-browser session/secure saved test session to
   inspect upload, drawing lists, rules and an actual drawing workspace. No need
   to create another account. Until then, protected-page visual acceptance remains open.
3. In that workspace, manually check the unverified zone/exit/room/table/rule states
   listed above, without treating deferred backend persistence as frontend proof.
4. Existing external limitations remain: House/Fit originals, matching reference
   drawing data, official BIM-170 materials and deferred backend integration.
   These were not reinvestigated and were not counted as newly found defects.

Shared auth and preview styling is broadly coherent, but the protected application
cannot be certified from anonymous redirects. A draft PR should retain these limits.

## Repository state

No source was edited during verification. At entry, `apps/web/next-env.d.ts` already
had generated development-route import changes (`.next/types` to `.next/dev/types`)
from the running Next server. Left untouched. This report is a new uncommitted file;
the working tree therefore is not clean. No commit, push or Jira modification.
