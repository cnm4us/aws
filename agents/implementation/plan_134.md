# Plan 134: Admin Debug Controls + Browser Debug Inventory

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Debugging currently relies on remembering many localStorage/query toggles for `dlog` (color console logs) and structured browser-debug emission (`debug/console/*.ndjson`).
  - Toggles are documented but not centrally discoverable in the UI.
- In scope:
  - Create a canonical inventory of debug toggles.
  - Add an admin-only `/admin/debug` page to manage debug flags.
  - Keep existing debug behavior intact (no regressions).
- Out of scope:
  - Production analytics pipeline changes.
  - Replacing existing debug systems.
  - Broad non-admin UX changes.
- Constraints:
  - Admin-only visibility.
  - Client-side convenience controls only (localStorage/query behavior).
  - Zero functional impact when debug is off.

## Locked Decisions
- Add a dedicated admin page, not a feed menu item.
- Route: `/admin/debug`.
- Page is site-admin only (same guard model as other `/admin/*` routes).
- The page manages both families of flags:
  - `dlog` flags (`DEBUG*`)
  - structured browser debug flags (`browser:debug`, `message:debug`)
- Initial page actions:
  - `Apply + Reload`
  - `Copy Current Flags`
  - `Clear Debug Flags`
- Keep existing docs, but update them to point to `/admin/debug` as the primary workflow.

## Phase Status
- A: Complete
- B: Complete
- C: Complete
- D: Pending

## Phase A — Canonical Inventory + Runtime State Helper
- Goal:
  - Define a single canonical debug inventory and expose current runtime state in a machine-readable shape for the admin page.
- Steps:
  - [x] Add a small frontend debug metadata module (keys, labels, descriptions, type, defaults, category grouping).
  - [x] Include all currently supported toggles:
    - `DEBUG`, `DEBUG_ALLOW_PROD`
    - namespace toggles: `DEBUG_FEED`, `DEBUG_SLIDES`, `DEBUG_AUTH`, `DEBUG_VIDEO`, `DEBUG_NETWORK`, `DEBUG_RENDER`, `DEBUG_PERF`, `DEBUG_PERM`, `DEBUG_ERRORS`
    - ID filters: `DEBUG_FEED_ID`, `DEBUG_SLIDE_ID`, `DEBUG_VIDEO_ID`
    - structured emit flags: `browser:debug`, `message:debug`
  - [x] Add helper functions:
    - read all current values
    - apply changes
    - clear debug keys
    - generate copy/paste snippets
- Test gate:
  - `npm run web:build`
  - verify helper returns expected state in browser dev console for known set/unset keys
- Acceptance:
  - One canonical inventory exists and can drive docs + UI without duplicated key lists.
  - Completed in `frontend/src/debug/inventory.ts`.

## Phase B — Admin `/admin/debug` Page
- Goal:
  - Provide admin UI for enabling/disabling and filtering debug flags without manual DevTools typing.
- Steps:
  - [x] Add `/admin/debug` route to admin page router and nav.
  - [x] Build page sections:
    - master switches
    - namespace toggles
    - ID filters
    - structured browser emit toggles
  - [x] Add controls:
    - `Apply + Reload`
    - `Copy Current Flags`
    - `Clear Debug Flags`
  - [x] Add concise usage hints on the page (including query-param bootstrap examples).
- Test gate:
  - `npm run build`
  - `npm run web:build`
  - manual smoke test:
    - open `/admin/debug`
    - enable selected flags
    - reload
    - verify `dlog.currentFlags()` and structured debug behavior reflect changes
- Acceptance:
  - Admin can configure active debug session entirely from `/admin/debug`.
  - Completed with server-rendered admin route and localStorage control script in `src/routes/pages.ts`.

## Phase C — Docs + Tooling Alignment
- Goal:
  - Keep docs and operator workflow aligned with the new page.
- Steps:
  - [x] Update `docs/DEBUG.md` with canonical key table + `/admin/debug` workflow.
  - [x] Update `agents/tools/debugging.md` to reference `/admin/debug` for setup.
  - [x] Keep command-line/devtools fallback instructions for non-admin contexts.
- Test gate:
  - doc review for key parity against runtime inventory
- Acceptance:
  - No drift between code and docs for debug toggles.
  - Completed for `/admin/debug` workflow and fallback commands.

## Phase D — Optional Follow-up: dlog -> Structured Emit Bridge
- Goal:
  - Optionally mirror selected `dlog` events into `/api/debug/browser-log` while preserving colored browser console output.
- Steps:
  - [ ] Add opt-in bridge in `frontend/src/debug/index.ts` gated by explicit flag.
  - [ ] Map namespace/event/meta into structured payload format.
  - [ ] Add dedupe guard so existing DOM-bridge events are not double-counted.
- Test gate:
  - enable bridge + run debug bundle
  - verify new categories appear in `debug/console/*.ndjson` and timelines without duplicates
- Acceptance:
  - dlog can be persisted to file when explicitly enabled.

## Change Log
- (uncommitted) add canonical debug inventory + state/apply/clear/snippet helpers
- (uncommitted) add `/admin/debug` page + admin nav item + localStorage debug controls
- (uncommitted) update debug docs to make `/admin/debug` the primary setup path
- (uncommitted) add message debug filter options (`message:debug:events`, `message:debug:sample`, `message:debug:level`) and wire them into structured browser emit

## Validation
- Environment:
  - local dev (`npm run serve:jaeger:log`)
- Commands run:
  - (pending per phase)
- Evidence files:
  - `debug/console/*.ndjson`
  - `debug/terminal/*.txt`
  - `tests/runs/api-curl/*` (when bundle runs are used)
- Known gaps:
  - Phase D is optional and may be deferred.

## Open Risks / Deferred
- Risk:
  - Key drift if inventory and docs are maintained separately.
- Mitigation:
  - Runtime inventory is source-of-truth; docs reference it explicitly.
- Deferred item:
  - Phase D bridge if Phase A-C already satisfies current debugging needs.

## Resume Here
- Next action:
  - Start Phase A by adding the canonical frontend debug inventory module.
- Blocking question (if any):
  - none
