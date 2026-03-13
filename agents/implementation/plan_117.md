# Plan 117: Prompt Sequencing v3 (Non-Destructive Prompt Slides)

## Goal
Remove prompt/index instability by treating injected prompts as first-class slides in the feed sequence instead of deleting them after dismiss.  
This plan adopts feed-native behavior: users can scroll past a prompt, keep going, and scroll back to it.

## Why This Plan
Current behavior mutates the slide array in-place when prompt state changes (dismiss/pass-through cleanup).  
That can shift indices during gesture and playback lifecycles, which is the root class of bounce/freeze regressions we have been fixing.

## Product Decisions (Locked)
- Prompt insertion remains server-decided (`/api/feed/prompt-decision`).
- Once inserted, a prompt is a normal slide in the active session sequence.
- Prompt is no longer removed immediately from the slide array.
- Prompt interaction options for this phase:
  - CTA buttons
  - scroll past (no hard dismiss required)
- The prompt should be revisitable by scrolling backward, same as any slide.

## Non-Goals (This Phase)
- Cross-session persistence of inserted prompt instances.
- A/B orchestration redesign.
- Sponsored/fund-drive injection arbitration (future multi-insert engine).

## UX Behavior
- Prompt appears as a normal slide in flow.
- Scrolling past a prompt does not remove it.
- No “poof” removal animation and no index collapse.
- CTA taps work exactly as today.
- Optional: retain a lightweight “Not now” later, but not as destructive array deletion.

## Technical Design
### 1) Sequence Model
- Keep a stable sequence item shape for feed rendering:
  - `kind: 'content' | 'prompt'`
  - `sequenceKey` (stable unique key per rendered instance)
  - `contentId` or `promptId`
- Keep logical progression metrics keyed by stable content sequence keys, not by raw `index`.

### 2) Insertion Strategy
- Decision service still runs from client counters.
- On `should_insert=true`, insert prompt item after active content item.
- Dedupe insertion by session + prompt id + cooldown key to prevent duplicate reinsert spam.
- Do not remove other prompt items during insertion.

### 3) Prompt Lifecycle Events
- Keep existing events: `impression`, `click`, `auth_start`, `auth_complete`.
- Add/standardize pass-through event:
  - `pass_through` when active slide changes from prompt to non-prompt via scroll.
- Keep category and session tags on all events.

### 4) Playback/Gesture Stability
- Because prompt is not deleted on pass-through, active slide index remains stable.
- Video play/pause logic should no longer be interrupted by prompt array collapse.
- Reanchor uses sequence index without forced preserve-index corrections caused by deletion.

## API/Backend Impact
- No required schema change for MVP of this phase.
- Optional backend enhancement:
  - decision response can include a short-lived dedupe token (`decision_key`) to avoid duplicate insertions in race windows.

## Frontend Scope (`frontend/src/app/Feed.tsx`)
- Remove destructive dismiss/remove path from prompt pass-through logic.
- Remove prompt-filtering insertion pattern (`withoutPrompts`) and keep prior prompt instances.
- Keep/adjust counters to track logical slide traversal by stable content id.
- Update prompt card UI to remove hard dismiss affordance for this phase.

## Observability and Analytics
- Add span/event tags:
  - `app.prompt.lifecycle=inserted|impression|pass_through|click|auth_start|auth_complete`
  - `app.prompt.sequence_key`
  - `app.prompt.revisit=true|false` (first revisit only)
- Add simple admin prompt report counters:
  - impressions
  - pass-throughs
  - CTA clicks
  - auth starts/completions

## Phases
### Phase A — Sequence Stabilization
- Introduce sequence-stable prompt/content item identity.
- Remove prompt deletion on pass-through.
- Keep feed index stable during swipe progression.

Acceptance:
- Scrolling past prompt never causes bounce-back due to prompt removal.
- User can scroll back to prompt instance.

### Phase B — UI Simplification
- Remove dismiss button from prompt auth widget in feed context.
- Keep Register/Login CTA behavior.
- Ensure prompt preview/admin still reflects this behavior.

Acceptance:
- Prompt has CTA + scroll-only exit path.
- No destructive prompt removal from feed state.

### Phase C — Insertion/Dedupe Hardening
- Replace “remove all prompts then reinsert” insertion with append-after-active logic.
- Add dedupe guard per session prompt insertion window.

Acceptance:
- No duplicate prompt stacks from rapid swipe + decision races.

### Phase D — Metrics and Tracing
- Emit `pass_through` event.
- Add prompt lifecycle tags to traces and analytics rollups.

Acceptance:
- Can compare CTA conversion against pass-through rate per prompt/category.

### Phase E — Mobile Regression Sweep
- iOS Safari and Chrome mobile emulation:
  - forward/back scroll
  - fast swipe
  - tap-to-play continuity on non-prompt slides after prompt pass

Acceptance:
- No playback freeze or forced snap-to-prompt behavior in tested flows.

## Test Plan
1. Anonymous global feed loads and prompt injects per rules.
2. Scroll past prompt, continue 10+ slides, then scroll back to prompt.
3. Confirm non-prompt slides continue normal play/pause behavior after prompt pass-through.
4. Confirm CTA click/auth events still fire with correct prompt/session metadata.
5. Confirm no duplicate prompt insertion under rapid swipe behavior.

## Risks and Mitigations
- **Risk:** Too many prompt slides accumulate in long sessions.
  - **Mitigation:** insertion dedupe + cooldown + per-session max from rule engine.
- **Risk:** Loss of explicit dismiss may reduce immediate control.
  - **Mitigation:** treat pass-through as primary “not now” behavior; revisit optional non-destructive hide later.
- **Risk:** Analytics continuity with prior dismiss metric.
  - **Mitigation:** map old dismiss intent to new pass-through semantics in reporting notes.

## Future Extension (Aligned with Queue Discussion)
After this stabilization, we can adopt windowed rendering and multi-insert arbitration:
- client JSON queue
- render window (e.g., 5 slides)
- insertion arbiter for prompt/sponsor/fund-drive candidates
- logical cursor independent of DOM index
