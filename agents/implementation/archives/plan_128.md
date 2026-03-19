# Plan 128: Feed Sequence Engine v1 (Queue-First Merge, Stable Keys, Windowed Render)

## Goal
Replace index-fragile feed rendering with a sequence-first engine that:
- merges content JSON + prompt JSON before render,
- uses stable identity keys instead of positional index as source-of-truth,
- keeps slide behavior uniform in v1 (no special hidden-dismiss behavior),
- prepares clean integration points for analytics rollout.

This plan intentionally ships feed mechanics first, then enables broader analytics work.

## Scope Decisions (Locked for v1)
- Prompts are treated as normal slides once inserted.
- No `dismiss -> hidden` behavior in v1 (keep as future option).
- Keep existing UX expectations for swipe/play and prewarm.
- Keep current backend decision endpoint shape for prompts unless audit proves blocker.

## Non-Goals (v1)
- Multi-prompt arbitration with priority conflicts across many prompt types.
- Cross-session persistence of injected prompt instances.
- Full analytics implementation (only low-level hooks here).

## Target Architecture
## 1) Data Queues
- `contentQueue`: content slide objects from feed endpoints.
- `injectableQueue`: prompt/injectable candidates from decision pipeline.
- `sequence`: merged logical list used by navigation and rendering.

## 2) Stable Identity
- Each sequence item has immutable `sequenceKey`:
  - content: `content:<contentId>`
  - prompt instance: `prompt:<promptId>:<instanceId>`
- Active cursor tracked by key (`activeSequenceKey`), not raw array index.

## 3) Windowed Rendering
- Render only a bounded window around active key.
- Suggested default window: `2 behind / active / 4 ahead` (7 DOM slides).
- Prewarm policy remains, but tied to window positions (active/+1/+2).

## 4) Merge Before Render
- Prompt insertion occurs in sequence assembly/scheduler step.
- DOM receives already-ordered merged sequence subset.
- No live splice/remove mutations on rendered array during gestures.

## 5) Navigation
- Build `visibleKeys` from sequence (all visible in v1).
- Swipe next/prev traverses `visibleKeys`.
- Reanchor and playback use key mapping to current window index.

## Migration Strategy
Use a feature flag: `FEED_SEQUENCE_ENGINE_V1=1`.

- `off`: current renderer path.
- `on`: new queue/sequence/window path.
- Both paths can coexist temporarily for A/B QA and rollback.

## Audit Incorporation (v2)
Based on `agents/implementation/archives/notes/notes_plan_128_feed_audit.md`, these constraints are now explicit:
- Replace index identity (`items[index]` + `rail.children[index]`) with key identity.
- Remove `withoutPrompts` insertion behavior (do not drop prior prompt instances during insertion).
- Avoid list-shape mutation (`filter/remove`) during touch gesture completion paths.
- Move snapshot/restore anchoring from numeric index to `activeSequenceKey`.
- Keep current backend prompt-decision contract (eligibility-focused API is sufficient for v1).

## Phases
### Phase A — Draft Spec + Invariants
- Finalize sequence object contract and key format.
- Define navigation invariants:
  - active key always exists in sequence,
  - no duplicate `sequenceKey`,
  - gesture never mutates sequence identity during transition.
- Define render-window + prewarm defaults.

Acceptance:
- spec document complete and reviewed.
- invariant checklist agreed.

### Phase B — Deep Audit of Current Feed Code
- Audit current `frontend/src/app/Feed.tsx` for:
  - where index is source-of-truth,
  - where items are mutated during prompt lifecycle,
  - gesture/reanchor coupling points,
  - prewarm/attach behavior,
  - known iOS edge paths.
- Produce detailed audit notes in `agents/implementation/archives/notes/notes_plan_128_feed_audit.md`.

Acceptance:
- audit note maps current flows and risk hotspots with file/section references.

### Phase C — Revise Plan from Audit Findings
- Update this plan with concrete migration steps and constraints discovered in audit.
- Lock rollout gates and test matrix based on real code paths.

Acceptance:
- `plan_128.md` v2 reflects audited reality.

### Phase D — Sequence Core + Keyed Cursor
- Introduce `SequenceItem` abstraction in feed state:
  - `sequenceKey`, `kind`, source refs, render payload.
- Add key-based active state (`activeSequenceKey`) and helper maps:
  - `key -> logical position`,
  - `key -> window position`.
- Keep old index temporarily as derived value only for compatibility during migration.
- Keep existing fetch endpoints and content object shape.

Acceptance:
- active navigation source-of-truth is key-based, not array position.
- compatibility layer still supports current gesture/play paths.

### Phase E — Queue Merge Pipeline (Content + Prompts)
- Build scheduler that merges prompt candidates into sequence before render.
- Use dedupe guard per prompt instance/session window.
- Keep prompts as normal sequence entries in v1.
- Replace current prompt insertion behavior that removes prior prompts (`withoutPrompts` path).
- Ensure prompt pass-through does not require destructive removal to maintain flow.

Acceptance:
- prompt insertion does not cause bounce/reindex regressions.
- prior prompt instances can remain in sequence and are back-scrollable.

### Phase F — Windowed DOM Renderer + Prewarm Mapping
- Render bounded DOM window from sequence around active key.
- Preserve playback behavior:
  - active plays,
  - near-ahead prewarm,
  - far slides detach/poster.
- Ensure swipe/reanchor logic targets active key and current window index mapping.
- Preserve existing warm modes from `HLSVideo` (`attach`/`buffer`) with window-aware assignment.
- Enforce bounded DOM count (target window size) in runtime assertions.

Acceptance:
- smoother memory/DOM footprint with parity behavior in swipe/play.
- no reliance on `rail.children[index]` for durable identity.

### Phase G — Snapshot/Restore Conversion
- Convert snapshot cache to store and restore by `activeSequenceKey` (with safe fallback).
- Keep UX parity for feed switches/revisits while removing index-identity assumptions.
- Validate canonical path + snapshot interaction under new keyed model.

Acceptance:
- snapshot restore lands on correct logical slide even after prompt insertions.

### Phase H — Minimal Analytics Hooks (Not Full Analytics)
- Emit internal hook events from new engine boundaries:
  - `sequence_window_shift`,
  - `sequence_prompt_inserted`,
  - `sequence_active_key_changed`.
- Keep hooks lightweight and optional; full reporting deferred to analytics plans.

Acceptance:
- instrumentation points are available for plan 118/119 attachment.

### Phase I — QA Matrix + Rollout
- Checklist document: `agents/implementation/archives/plan_128_phase_i_checklist.md`
- Run deterministic matrix on both old/new engines:
  - fast swipe,
  - prompt pass-through,
  - back-scroll,
  - tap-to-play continuity,
  - iOS Safari regression pass.
- Add audit-derived regressions:
  - insertion while current video playing,
  - long session with repeated prompt insertions,
  - restore-from-snapshot with prompts present.
- Roll out with flag on dev first, then default on after stability window.

Acceptance:
- no freeze/bounce regressions in tested scenarios.
- fallback path validated.

## Test Matrix (Required)
1. Anonymous global feed with low-threshold prompt rules.
2. Repeated prompt insertions over long scroll session.
3. Scroll forward/backward across recently inserted prompts.
4. Playback continuity after prompt pass-through.
5. iOS Safari rapid swipe + tap interaction stress.
6. Memory profile comparison old vs new (long session).
7. Snapshot restore targets correct slide by key after prompt insertion.
8. Prompt insertion while actively playing video does not pause/bounce unexpectedly.

## Risks and Mitigations
- **Risk:** Migration complexity in `Feed.tsx`.
  - **Mitigation:** feature-flagged parallel path + phased extraction.
- **Risk:** Gesture regressions while remapping index->key.
  - **Mitigation:** strict invariant checks + QA matrix.
- **Risk:** Prompt duplication in scheduler races.
  - **Mitigation:** prompt instance dedupe keys.
- **Risk:** Snapshot regressions after key migration.
  - **Mitigation:** dual-write snapshot fields (index + key) during transition window.
- **Risk:** Analytics mismatch during transition.
  - **Mitigation:** minimal hooks now, full analytics only after engine stabilizes.

## Follow-On
After Plan 128 stabilizes:
- proceed with `plan_119` nominal-first analytics rollout,
- keep `dismiss -> non-visible` as a planned v2 experiment only after sequence engine is stable.
