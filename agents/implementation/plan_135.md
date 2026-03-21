# Plan 135: Unified Client Debug Model (Console + Emitter)

Status: Active

## Feature Reference
- Feature doc: `none`

## Summary
Unify feed/slide/message client debug into one event/filter model while keeping two outputs:
- colored browser console (`dlog`)
- structured emitter (`/api/debug/browser-log` -> `debug/console/*.ndjson`)

Goal: remove bifurcated key sets and make `/admin/debug` the single control surface.

## Locked Decisions
- Keep both outputs; do not collapse into one.
- Use one shared filter model for all client debug events.
- Add new unified keys; keep old keys as compatibility aliases for a migration window.
- Emitter should only send events that pass the same unified filters as console.

## Phase Status
- A: Complete
- B: Complete
- C: Complete
- D: Complete
- E: Complete

## Phase A — Unified Config Contract
- Goal:
  - Define and parse one canonical client-debug keyset.
- Steps:
  - [x] Define new canonical keys (localStorage + query bootstrap):
    - `CLIENT_DEBUG`
    - `CLIENT_DEBUG_NS`
    - `CLIENT_DEBUG_EVENTS`
    - `CLIENT_DEBUG_EXCLUDE`
    - `CLIENT_DEBUG_LEVEL`
    - `CLIENT_DEBUG_SAMPLE`
    - `CLIENT_DEBUG_EMIT`
    - optional: `CLIENT_DEBUG_ID`, `CLIENT_DEBUG_SESSION`
  - [x] Add parser/normalizer module for these keys.
  - [x] Keep alias readers for existing keys (`DEBUG*`, `browser:debug`, `message:debug:*`) with clear precedence rules.
- Test gate:
  - `npm run build`
  - verify effective config object for combinations of new + old keys
- Acceptance:
  - Canonical config exists and can drive both outputs.
  - Implemented in `frontend/src/debug/unifiedConfig.ts`.

## Phase B — Shared Event Dispatcher
- Goal:
  - Route all client debug through one filter/effect pipeline.
- Steps:
  - [x] Add shared client debug dispatcher API used by feed/slides/message/video paths.
  - [x] Apply unified filters once per event.
  - [x] Fan out to:
    - console output (styled namespace labels)
    - structured emit queue (when `CLIENT_DEBUG_EMIT=1`)
  - [x] Remove message-only emit special-casing.
- Test gate:
  - `npm run build`
  - manual: verify same event visibility between console and emit for identical filters
- Acceptance:
  - Console and emit use identical selection semantics.
  - Completed for feed message/index/sequence debug event streams.

## Phase C — Admin Debug UI Migration
- Goal:
  - Make `/admin/debug` operate on the unified contract.
- Steps:
  - [x] Update `/admin/debug` controls to write unified keys first.
  - [x] Group controls by:
    - namespaces
    - event include/exclude
    - level/sample
    - outputs (console, emitter)
  - [x] Keep a temporary legacy section with migration action.
  - [x] Expand event picker to namespace-aware options (message/feed/index/sequence/video).
- Test gate:
  - `npm run build`
  - manual UI smoke of apply/copy/clear + picker
- Acceptance:
  - `/admin/debug` is single entrypoint for unified debug config.
  - Completed with unified controls, legacy snapshot, and migration action.

## Phase D — Compatibility Cutover
- Goal:
  - Preserve usability while transitioning off legacy keys.
- Steps:
  - [x] Legacy keys remain readable during migration.
  - [x] Saving from `/admin/debug` writes unified keys; optional cleanup clears legacy keys.
  - [x] Document precedence and migration behavior.
- Test gate:
  - legacy-only key session still works
  - save from UI migrates behavior without regression
- Acceptance:
  - Unified keys are primary; legacy keys are transitional only.
  - Completed for runtime parsing, admin UI behavior, and docs.

## Phase E — Bundle/Analysis Alignment
- Goal:
  - Keep debug-bundle interpretation aligned to unified client debug.
- Steps:
  - [x] Add unified debug-config snapshot section in bundle summary.
  - [x] Add mode-aware summary sections (`message`, `feed`, `mixed`) from console categories/events.
  - [x] Keep message Jaeger presets; add feed-focused summary heuristics (index/sequence/reanchor).
- Test gate:
  - `npm run debug:bundle -- --lookback 30m`
  - verify summary includes active config + correct mode signals
- Acceptance:
  - Bundle outputs explain observed event volume/filtering under unified config.
  - Completed via `scripts/debug-bundle.sh` mode-aware summaries and `debug:config` snapshot emission.

## Change Log
- (uncommitted) add unified client debug config parser with new `CLIENT_DEBUG*` keys + legacy key compatibility
- (uncommitted) wire feed message/index/sequence debug through unified dispatch filtering for both console and emitter
- (uncommitted) add per-event correlation fields (`debug_event_id`, `debug_seq`) to console payloads and browser debug NDJSON records
- (uncommitted) migrate `/admin/debug` to unified keys with namespace/event/output controls and legacy migration action
- (uncommitted) document unified-key precedence with legacy compatibility notes
- (uncommitted) add bundle mode switch (`--mode`) + unified config snapshot + mode-aware console summaries

## Validation
- Environment:
  - local dev with `npm run serve:jaeger:log`
- Commands run:
  - (pending per phase)
- Evidence files:
  - `debug/console/*.ndjson`
  - `debug/terminal/*.txt`
  - `tests/runs/api-curl/*`
- Known gaps:
  - none

## Open Risks / Deferred
- Risk:
  - Mixed old/new key states can confuse debugging sessions.
- Mitigation:
  - explicit precedence + UI migration helper + summary config snapshot.
- Deferred:
  - hard removal of legacy keys to follow in a separate cleanup plan after stabilization.

## Resume Here
- Next action:
  - Evaluate whether to commit and begin separate cleanup pass for legacy keys.
- Blocking question (if any):
  - none
