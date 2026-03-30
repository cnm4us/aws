# Plan 149: Message Interaction Lock (Short Scroll Pause)

Status: Draft

## Context
- Problem:
  - Some message impressions are skipped too quickly to register intent.
  - We want a short, per-message interaction lock that temporarily blocks slide navigation.
- Goal:
  - Add an opt-in lock (`250ms`–`1000ms`) per message impression.
  - During lock: user can still tap non-navigation UI.
  - On unlock: clear visual cue that CTA actions are ready.
- Out of scope:
  - Global feed-level lock behavior.
  - Long-duration gating (>1000ms).

## Locked Decisions
- Per-message field: `interaction_lock_ms`.
- Default `0` (disabled).
- Allowed range: `0..1000` ms.
- Navigation lock scope:
  - Block vertical slide navigation only.
  - Allow taps on non-navigation UI while lock is active.
- Lock applies once per message impression.
- Accessibility:
  - Respect reduced-motion for unlock animation.

## Phase Status
- A: Pending
- B: Pending
- C: Pending
- D: Pending
- E: Pending

## Phase A — Data + Admin UI
- Goal:
  - Store and edit per-message lock duration.
- Steps:
  - [ ] Add `feed_messages.interaction_lock_ms INT NOT NULL DEFAULT 0`.
  - [ ] Repository/service wiring for create/update/read.
  - [ ] Admin Message editor input:
    - Label: `Interaction Lock (ms)`
    - Help text: `Temporarily blocks slide scroll on message impression; non-navigation taps still work.`
    - Validation: clamp `0..1000`.
- Acceptance:
  - Field persists and round-trips in admin UI.

## Phase B — Client Runtime Lock Gate
- Goal:
  - Enforce lock in feed gesture path.
- Steps:
  - [ ] Add message-impression lock state keyed by `message_sequence_key` (or equivalent impression key).
  - [ ] On message impression start:
    - if `interaction_lock_ms > 0`, start timer and set `navigationLocked=true`.
  - [ ] In swipe/scroll handler:
    - suppress navigation while locked.
    - do not suppress non-navigation taps.
  - [ ] Auto-release on timer completion and on unmount cleanup.
- Acceptance:
  - User cannot navigate away during lock window.
  - User can still tap CTA/buttons during lock window.

## Phase C — Visual Unlock State
- Goal:
  - Make lock/release state obvious.
- Steps:
  - [ ] While locked:
    - CTA buttons visually disabled.
    - Optional short progress indicator/countdown.
  - [ ] On release:
    - CTA enabled state + subtle one-shot highlight/pulse.
    - reduced-motion mode uses non-animated style change only.
- Acceptance:
  - Clear visual distinction between locked and unlocked states.

## Phase D — Analytics + Observability
- Goal:
  - Capture lock behavior for QA and tuning.
- Steps:
  - [ ] Client debug events:
    - `message_lock_started`
    - `message_lock_released`
    - `message_lock_skipped`
  - [ ] Include fields:
    - `message_id`, `campaign_key`, `interaction_lock_ms`, `surface`, `delivery_context`, `journey_id/step_id` when present.
  - [ ] Pino/Jaeger tags for server-side decision context may include configured lock duration for selected message.
- Acceptance:
  - Debug bundle and Jaeger can explain whether lock ran and for how long.

## Phase E — QA Matrix + Rollout Guardrails
- Goal:
  - Validate UX and prevent regressions.
- Steps:
  - [ ] Smoke matrix:
    - `0ms`, `250ms`, `600ms`, `1000ms`.
    - standalone + journey step.
    - global/group/channel surfaces.
  - [ ] Verify no passive listener warnings introduced.
  - [ ] Confirm lock applies once per impression and resets on next impression.
  - [ ] Add docs for recommended values (`250..600ms` default recommendation).
- Acceptance:
  - Feature is stable, measurable, and does not degrade baseline feed UX.

## Open Questions
- Should CTA clicks during lock be allowed to progress journey immediately, or only after unlock?
  - Proposed default: allow click analytics during lock, but do not auto-progress via click-only policy until lock releases.
- Should we show numeric countdown vs simple visual bar?
  - Proposed default: simple bar; no numeric timer.

## Resume Here
- Next action:
  - Implement Phase A when prioritized.
