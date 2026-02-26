# Plan 98 — CreateVideo Hybrid Optimization (With Split Map)

## 1. Goal
Reduce `/create-video` initial load cost without slowing current feature velocity.

Hybrid strategy:
1. Do low-risk lazy-split architecture now.
2. Continue feature work in cleaner modules.
3. Do deeper performance optimization later when UX stabilizes.

## 2. Why Hybrid
1. Optimizing everything now slows delivery and causes churn while UI is still evolving.
2. Deferring all optimization makes refactor risk larger as `CreateVideo.tsx` keeps growing.
3. A front-loaded split map gives immediate wins and clearer ownership boundaries.

## 3. Current Baseline
1. `frontend/src/app/CreateVideo.tsx` is a monolith (~25k lines).
2. Current `CreateVideo` build chunk is ~505 KB raw (~96 KB gzip).
3. Route already lazy-loads page-level `CreateVideo`, but internal features are not split.

## 4. Split Map (Required for Hybrid Plan)

### 4.1 Target lazy bundles inside CreateVideo route
1. `cv-shell`
   - project load/create, autosave, undo/redo, selected ids, common refs
   - target: 120-160 KB raw
2. `cv-timeline-lanes`
   - lane rendering, drag/trim/split/ripple, timeline interactions
   - target: 90-130 KB raw
3. `cv-preview-stage`
   - preview composition, playback/scrub controls, active-at-playhead overlays
   - target: 70-100 KB raw
4. `cv-context-actions`
   - context menu trees (Actions/Quick Changes), guideline/playhead/timeline actions
   - target: 30-50 KB raw
5. `cv-screen-title-quick-panel`
   - floating style/placement mini-panel and placement overlay interactions
   - target: 50-80 KB raw
6. `cv-editor-video-graphics`
   - Video Properties, Graphic/Still/Overlay-still editors
   - target: 60-90 KB raw
7. `cv-editor-branding-audio`
   - Logo, Lower Third, Audio, Narration, Screen Title customize modal
   - target: 45-70 KB raw
8. `cv-export-debug`
   - export dialog/status polling + debug actions
   - target: 15-30 KB raw

### 4.2 Extraction order (risk-minimized)
1. Extract shared pure helpers first:
   - screen-title style/placement math
   - fade/timing helpers
   - render payload normalization
2. Extract modal editors next (least coupled to timeline render loop):
   - `cv-editor-video-graphics`
   - `cv-editor-branding-audio`
3. Extract context menu/action rendering:
   - `cv-context-actions`
4. Extract quick panel + placement overlay:
   - `cv-screen-title-quick-panel`
5. Extract preview stage:
   - `cv-preview-stage`
6. Extract lanes rendering:
   - `cv-timeline-lanes`
7. Keep shell last:
   - `cv-shell` remains host/container for wiring and state ownership

### 4.3 Loading policy
1. Keep shell + minimal timeline surface eagerly loaded on route entry.
2. Lazy-load editors and quick tools on first open.
3. Prefetch likely next chunks after idle:
   - quick panel
   - most-used editor bundle(s)
4. No backend/API behavior changes in this plan.

## 5. Phased Implementation

### Phase A — Split Map + Guardrails
Scope:
1. Add this split map as source of truth.
2. Add temporary ownership comments in `CreateVideo.tsx` section boundaries.
3. Add build-size snapshot logging to compare before/after.

Checkpoint:
1. Team can point to exact extraction order and chunk targets.
2. No runtime behavior change.

---

### Phase B — Low-Risk Splits Now
Scope:
1. Move pure helper logic into dedicated modules under `frontend/src/app/createVideo/`.
2. Extract both editor modal bundles and lazy-load them.
3. Extract `cv-context-actions` and lazy-load menu panel rendering.
4. Keep runtime behavior identical.

Checkpoint:
1. `/create-video` behavior is unchanged.
2. Initial CreateVideo chunk decreases measurably.
3. No regression in save/export or timeline edits.

---

### Phase C — Continue Feature Work (on New Boundaries)
Scope:
1. New feature refinement continues, but code lands in split modules/components.
2. Avoid adding new heavy UI back into the shell.
3. Only fix bugs/regressions found from Phase B split.

Checkpoint:
1. Feature velocity continues with lower merge risk.
2. Bundle shape remains stable (no major re-monolith growth).

---

### Phase D — Deeper Optimization Later
Scope:
1. Extract `cv-screen-title-quick-panel`, `cv-preview-stage`, and `cv-timeline-lanes`.
2. Tune expensive re-render paths:
   - memo boundaries
   - stable callback/state slices
3. Optional: prefetch tuning by user intent signals.

Checkpoint:
1. Meaningful reduction in initial parse/execute on mid-tier phones.
2. Interaction responsiveness unchanged or improved.

## 6. Success Metrics
1. Initial `CreateVideo` chunk down from ~505 KB raw toward ~320-410 KB raw range.
2. Time-to-interactive on `/create-video` improved under CPU throttle.
3. No increase in major regression rate for timeline operations.

## 7. QA Matrix
1. Open `/create-video` with existing project and new project.
2. Add/split/trim/move items across all lanes.
3. Open each properties modal and save.
4. Use Screen Title quick panel style + placement + render/done flows.
5. Export and verify completed output.
6. Mobile Safari + Chrome mobile emulation checks.

## 8. Risks and Mitigations
1. Risk: Hidden coupling breaks behavior during extraction.
   - Mitigation: helper-first extraction and editor-first lazy chunks.
2. Risk: Lazy loading introduces modal-open delay.
   - Mitigation: prefetch likely chunks after idle.
3. Risk: State ownership confusion after split.
   - Mitigation: keep shell as single source of truth; pass typed props only.

