# Plan 128 — Phase I QA Checklist (Sequence Engine v1)

## Scope
Validate feed behavior with `VITE_FEED_SEQUENCE_ENGINE_V1=1` after Phase D–H changes:
- keyed cursor
- key-first snapshot/restore
- bounded render window with spacers
- sequence hook events
- prompt insertion as normal sequence slides

## Test Setup
- [ ] In `frontend/.env`: `VITE_FEED_SEQUENCE_ENGINE_V1=1`
- [ ] Rebuild frontend: `npm run web:build`
- [ ] Restart app: `npm run serve:jaeger`
- [ ] Use private/incognito session for anonymous prompt tests
- [ ] Confirm tag in Jaeger: `app.feed_sequence_engine=v1`

## Platforms
- [ ] iOS Safari (real device)
- [ ] Chrome mobile emulation (Windows/desktop)

## Core Functional Matrix

### 1) Navigation + Gesture Stability
- [ ] Slow swipe forward/back across 15+ slides
  - Expected: no bounce-back, no freeze, no index jump.
- [ ] Fast repeated swipes (5–10 rapid gestures)
  - Expected: active slide remains stable, no dead slide.
- [ ] Tap-to-play on active slide
  - Expected: play/pause remains responsive.
- [ ] Tap non-active slide to promote
  - Expected: reanchor to tapped slide and playback continuity.

### 2) Prompt Lifecycle in Sequence
- [ ] Trigger first prompt in anonymous global feed
  - Expected: prompt appears at expected cadence.
- [ ] Scroll past prompt without dismiss
  - Expected: feed continues; prompt remains in history.
- [ ] Dismiss a later prompt
  - Expected: dismissed prompt removed; non-dismissed prompt still back-scrollable.
- [ ] Continue scrolling until another prompt injects
  - Expected: no duplicate-at-insert-position glitch.

### 3) Playback + Prewarm + Windowing
- [ ] During normal scrolling, observe slide transitions near active index
  - Expected: no blank frame at window boundary.
- [ ] Verify memory/DOM behavior informally via Elements panel
  - Expected: bounded slide nodes, with top/bottom spacer divs present.
- [ ] Scroll back to older content after long forward run
  - Expected: remount/replay works, no stale video state.

### 4) Snapshot/Restore by Key
- [ ] Switch global -> group/channel -> global
  - Expected: restore lands on correct logical slide.
- [ ] Refresh while on later slide, then reload feed
  - Expected: restore aligns by key (not wrong neighbor after prompt inserts).
- [ ] Repeat after prompt insertion occurred
  - Expected: still restores correctly.

### 5) Hook Events (Phase H)
- [ ] Add listener in browser console:
  - `window.addEventListener('feed:sequence-hook', (e) => console.log('[seq-hook]', e.detail))`
- [ ] Trigger normal use (scroll + prompt insert)
  - Expected events seen:
  - `sequence_active_key_changed`
  - `sequence_window_shift`
  - `sequence_prompt_inserted`

### 6) Regression Guards
- [ ] Captions toggle still works for eligible slides.
- [ ] Like/comment/report interactions still work.
- [ ] Drawer feed switching still works.
- [ ] No new 4xx/5xx spikes in server logs tied to feed routes.

## Failure Capture Template
- Test case:
- Platform:
- Steps to reproduce:
- Expected:
- Actual:
- Console errors:
- Network errors:
- Sequence hook details (if relevant):

## Rollout Gate
- [ ] All checklist items pass on both platforms.
- [ ] No blocker/sev-high regression remains open.
- [ ] Keep `VITE_FEED_SEQUENCE_ENGINE_V1=1` in current dev env.
- [ ] If stable for sustained usage window, plan default-on flip with legacy fallback retained.
