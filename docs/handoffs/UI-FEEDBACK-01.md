# UI-FEEDBACK-01 — painted Home content and fixed data-path copy

2026-10-23. Worker #1 `branding_contracts`, requested Sol medium, actual UI effort unverified.
Branch `fix/launcher-play-path-feedback`, agent-1, baseline `a0a4bda`.
Implementation commit is this handoff's adding commit (`git log -1 --format=%H -- docs/handoffs/UI-FEEDBACK-01.md`).
#0 owns integration/main check. User asks finish these fixes and hand off to Claude; start no new tasks.

## Root cause and correction

Reproduced in production Electron BEFORE editing: screenshot was a solid red Home area and
`elementFromPoint` at BOTH server h1 and primary button centers hit the background IMG instead.
`BrandingVisual`'s z-index:1 child escaped its non-stacking `.branding-background` parent and
painted above `.shade` and `.copy`. The prior branding smoke checked DOM text/layout rather than
actual painting/hit targets and therefore missed this regression.

Scoped `.branding-background { isolation:isolate; pointer-events:none }` contains image fade
layers behind the following gradient/content. It covers default/custom/reduced-motion and the
no-product-state loading fallback without changing other page stacking or icon fade behavior.
The stronger smoke uses screenshots with bright foreground-text pixel assertions, live hit targets
and real fixture login-button clicks. Pointer-events alone cannot pass the custom red/green text
paint check. Transition assertions capture the data-fading mutation/hit targets structurally rather
than relying on polling a short fade after asynchronous service cleanup.

## Copy path and explicit scope extension

Settings retains exact full path text, title and selectable ellipsis. Its copy button never shrinks
away and remains usable during busy/game states. New Korean/English label/loading/success/failure keys
report success ONLY on true; false/rejection/missing optional API gives local honest failure feedback.
No memory save messages or Home result panels were restored.

Initial navigator.clipboard approach was rejected by actual application permissions: fixture applies
both production deny handlers, and permissions.query({name:'clipboard-write'}) reports **denied**.
No host clipboard read/write was attempted. #0 explicitly extended scope to minimal main/shared/
preload/product-IPC and exact root smoke bridge whitelist, preserving all permission policies.

Optional public `copyServerDataPath():Promise<boolean>` invokes its own **no-argument** channel.
`bindProductIpc` validates the existing trusted sender/main frame/URL and rejects extra arguments.
Main obtains CURRENT `service.snapshot().serverDataRoot` and calls an injected writer; production
wires it to Electron clipboard.writeText. No renderer path/text slot, arbitrary copy helper, raw error
or path response is added. Missing root/backend or writer failure returns false. There is no product
service/game/lock/auth lifecycle change. The fixture uses this actual handler/preload with a safe
in-memory injected writer, so test clipboard contents never touch the host clipboard.

## Evidence and checks

Node 24.21.0 / pnpm 10.34.7. All final checks succeeded:

- `pnpm --filter @torchlauncher/launcher typecheck`.
- `pnpm exec vitest run apps/launcher/src/main/product/ipc.test.ts apps/launcher/src/renderer/src`:
  **89 passed / 11 files**. IPC regressions cover exact current Unicode/Windows root, changed current
  root, no argument/text/path slot, wrong sender/frame/URL, missing root/backend and rejected writer.
- `pnpm --filter @torchlauncher/launcher build`.
- `node apps/launcher/scripts/branding-smoke.mjs`: production Electron native decoder/IPC/preload/full
  renderer and fake remote reader. Custom/default/reduced-motion Home at 760/1100 has painted heading/
  button text, reachable hit targets and working fixture primary clicks. Both-width transition mutation
  captures and loading fallback pass. Exact long single-separator Windows path is copied from main,
  title/selectable text retained, button visible at both widths and during busy/game, failure returns
  alert and enabled retry. Browser clipboard permission denial is asserted. Existing PNG/JPEG,
  decode-failure retention, fades and tombstone restart checks also pass.
- `node scripts/smoke.mjs`: passed both launcher and Studio renderer/navigation/IPC/isolation and
  760/1100 layouts with exact bridge whitelist including copyServerDataPath.
- Biome on changed TS/TSX/scripts: **10 files, clean**. Stylesheet formatting/check has the same
  **8 existing warnings**, no new warning/error. `git diff --check` passed.

Ignored local visual evidence under `apps/launcher/.cache/ui-feedback/` (regenerate by running smoke):
`home-before.png`, `home-custom-initial.png`, `home-custom-760.png`, `home-custom-1100.png`,
`home-default-reduced-760.png`, `home-default-reduced-1100.png`, `settings-760.png`, `settings-1100.png`.
#0 already inspected Home custom760; Settings screenshots are ready for final visual review.
These fixture screenshots contain only synthetic names/paths; no real user config/credentials.

Early expanded smoke issues were fixture-only: Electron evaluate's first argument is the Electron
module (payload is second); new English copy labels required locale-aware assertions. Corrected both.
The production Home defect and clipboard denial are separately proven as above.

## Claude continuation

No blockers, no active worker/test processes after final checks. No core/admin/dependencies/lockfile
or tracker changes. #0 must review/integrate this commit, run main verification and update tool handoff.
Actual native Windows Home/icon/path display and real clipboard paste remain manual verification;
do not claim a native host clipboard test from the injected writer. No new task is authorized by
this handoff beyond completing current integration and Claude continuation requested by the user.
