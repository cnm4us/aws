# Plan 128 Audit Notes: Current Feed Rendering and Prompt Injection

## Scope
Deep audit of current feed mechanics to inform `agents/implementation/archives/plan_128.md` migration.

Primary files reviewed:
- `frontend/src/app/Feed.tsx`
- `frontend/src/components/FeedVideo.tsx`
- `frontend/src/components/HLSVideo.tsx`
- `frontend/src/styles/feed.module.css`
- `src/routes/spaces.ts`
- `src/routes/feed-prompts.ts`
- `src/features/prompt-decision/service.ts`

## Executive Summary
Current feed behavior works, but it is structurally index-coupled:
- `items[]` is both data source and render/index identity.
- prompt insertion/removal mutates `items[]` while gestures/playback effects are active.
- `rail.children[index]` is used to resolve active DOM/video elements.

This is the root reason prompt lifecycle changes can cause bounce/freeze/reanchor artifacts.

Plan 128 direction (queue-first merge + stable keys + windowed render) is the correct fix.

## Current End-to-End Flow

### 1) Feed data fetch
- Global feed: `/api/feed/global` (`limit` default 20) in `src/routes/spaces.ts:474`.
- Space feed: `/api/spaces/:id/feed` (`limit` default 20) in `src/routes/spaces.ts:396`.
- Frontend fetch helpers: `fetchGlobalFeed` and `fetchSpaceFeed` in `frontend/src/app/Feed.tsx:280` and `frontend/src/app/Feed.tsx:253`.
- Load-more trigger when `remaining < 5` in `frontend/src/app/Feed.tsx:3398`.

### 2) Core state model
- Primary list state: `items: UploadItem[]` in `frontend/src/app/Feed.tsx:469`.
- Active pointer: `index` in `frontend/src/app/Feed.tsx:471`.
- Prompt objects are in same array as content (`itemType: 'prompt'`) in `frontend/src/app/Feed.tsx:453`.

### 3) Rendering
- `slides = items.map(...)` memo in `frontend/src/app/Feed.tsx:2362`.
- Prompt and content slides are rendered in same list.
- Full list of slide DOM nodes is rendered into rail: `slides` in `frontend/src/app/Feed.tsx:3714`.
- Rail is transformed vertically using `translate3d` and index-derived offset in `frontend/src/app/Feed.tsx:3333`.

### 4) Playback and prewarm
- DOM node exists for all fetched slides, but `<FeedVideo>` mounts only near active range:
  - active, +1, +2, +3..+5, and linger -1 (`isWarm/isPrewarm`) in `frontend/src/app/Feed.tsx:2729`.
- HLS lifecycle and warm modes (`attach`/`buffer`) in `frontend/src/components/HLSVideo.tsx`.

### 5) Prompt decision/insertion
- Decision request: `/api/feed/prompt-decision` in `frontend/src/app/Feed.tsx:2103`.
- Prompt payload fetch: `/api/feed/prompts/:id` in `frontend/src/app/Feed.tsx:306`.
- Insertion path currently does:
  - `withoutPrompts = prev.filter(!isPromptItem)` (drops all prompt slides),
  - then inserts one prompt near active index in `frontend/src/app/Feed.tsx:2134`.

### 6) Prompt dismissal/pass-through
- Explicit dismiss removes prompt from `items[]` via filter in `frontend/src/app/Feed.tsx:1829`.
- Pass-through auto-dismiss effect in `frontend/src/app/Feed.tsx:1868`.
- Additional stale-prompt cleanup behind active slide in `frontend/src/app/Feed.tsx:1877`.

## Critical Couplings and Risk Hotspots

### A) Index used as durable identity
- Active slide/video resolution uses `rail.children[index]` (`getSlide/getVideoEl`) in `frontend/src/app/Feed.tsx:1756`.
- Any `items[]` insertion/deletion changes index-to-DOM mapping while other effects are running.

Impact:
- reanchor jumps, stale video refs, bounce-backs under rapid gesture state changes.

### B) Prompt insertion removes prior prompts globally
- Insertion code removes all prompts before adding one (`withoutPrompts`) in `frontend/src/app/Feed.tsx:2134`.

Impact:
- forces list churn beyond local insertion point,
- prevents stable back-scroll behavior over prior prompt instances,
- increases chance of index race with touch/playing effects.

### C) Prompt removal mutates list during interaction cycle
- `dismissPromptSlide` filters out active prompt and may change index in same transition in `frontend/src/app/Feed.tsx:1829`.
- Pass-through effect can call dismiss in post-index-change effect (`frontend/src/app/Feed.tsx:1868`).

Impact:
- gesture engine and playback engine can observe different list shapes in short sequence.

### D) Custom gesture/scroll engine is fully manual
- viewport disables native scrolling (`touchAction: 'none'`) in `frontend/src/app/Feed.tsx:3700`.
- all navigation relies on gesture classifier + transform reanchor in `frontend/src/app/Feed.tsx:1800` and `frontend/src/app/Feed.tsx:3333`.

Impact:
- any index/list mismatch is user-visible as lock/bounce; browser native scroll cannot recover.

### E) Large render map dependencies
- `slides` memo depends on many maps/states (`likes`, `comments`, `reported`, `story`, etc.) in `frontend/src/app/Feed.tsx:3309`.

Impact:
- many updates cause broad remap of slide list and event handlers,
- makes timing-sensitive index/list races more likely.

### F) Snapshot/restore uses index-based anchor
- Snapshots keep `items + index` and restore by index in `frontend/src/app/Feed.tsx:1400`.

Impact:
- reinforces index as identity assumption instead of stable key identity.

## Backend Contract Notes (Prompt)
- Decision endpoint returns `should_insert`, `prompt_id`, `reason_code`, `session_id`; `insert_after_index` is currently null in route response (`src/routes/feed-prompts.ts:77` and `src/features/prompt-decision/service.ts`).
- Prompt decision state stores counters by session and merges with max/threshold logic in `src/features/prompt-decision/service.ts`.

Implication for Plan 128:
- frontend should own sequence placement strategy (key-based),
- backend decision can remain eligibility-focused in v1.

## What Is Working and Should Be Preserved
- HLS warm modes and Safari/non-Safari branch handling in `frontend/src/components/HLSVideo.tsx`.
- Existing prompt decision/rule engine API shape.
- Existing feed fetch pagination semantics (`limit=20`, cursor-based).
- Existing prompt and feed activity telemetry endpoints.

## Migration Constraints for Plan 128

1. **Do not use array position as identity** for active slide state.
2. **Do not mutate live rendered list shape during gesture frame**.
3. **Prompt merge should be sequence assembly step**, not render-time array surgery.
4. **Keep HLS prewarm policy**, but bind it to render-window positions.
5. **Preserve iOS gesture behavior** while swapping identity model.

## Recommended Refactor Cuts (Implementation Order)

### Cut 1: Introduce sequence item abstraction
- Add `sequenceKey`, `kind`, and source refs for content/prompt.
- Keep old renderer but derive from sequence list.

### Cut 2: Move active state to key-based cursor
- Track `activeSequenceKey`.
- Derive temporary window index for rail transform.

### Cut 3: Prompt scheduler pre-render merge
- Remove `withoutPrompts` path.
- Insert prompt instance into sequence only; keep old prompt instances in session flow.

### Cut 4: Windowed renderer
- Render bounded neighbors only.
- Keep media warm policy aligned to window offsets.

### Cut 5: Snapshot and restore by key
- Snapshot `activeSequenceKey` (not only numeric index).

## Proposed Plan 128 Updates from Audit
- Add explicit task to remove `withoutPrompts` insertion pattern (`frontend/src/app/Feed.tsx:2134` equivalent).
- Add explicit task to replace `getSlide(index)` identity with key-to-window mapping.
- Add explicit migration for snapshot subsystem to key-based anchor.
- Add a guardrail: no `setItems(filter/remove)` during touch gesture completion path.
- Add performance acceptance: DOM slide count remains bounded by window size.

## Test Cases to Add (Beyond Current Matrix)
1. Insert prompt while active content video is playing; verify playback continuity.
2. Rapid swipe across prompt boundary with no list-shape mutation side effects.
3. Back-scroll over prior prompt instance after additional insertions.
4. Snapshot restore into sequence with prompts present; active key resolves correctly.
5. Long session memory profile with bounded DOM node count.

## Conclusion
Current code confirms the architectural diagnosis:
- index and list-shape mutations are tightly coupled to gesture and playback timing.

Plan 128 should proceed with:
- sequence-key identity,
- pre-render merge,
- bounded render window,
- key-based navigation/reanchor.

That is the lowest-risk path to stable prompt mechanics and scalable future injectables.
