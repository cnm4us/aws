# Plan 155: Use Exports as Timeline Sources

Status: Completed (A–E)

## Context
- Create Video exports are already stored in `uploads` with `video_role='export'`.
- Export pipeline already queues thumbnail + edit-proxy generation.
- Timeline source pickers currently focus on existing asset buckets (Uploads/My Clips/Shared).

## Goal
Allow users to add their own exported videos as reusable source clips in new timelines.

## Non-Goals
- New render pipeline.
- New media storage format.
- Cross-org sharing redesign.

## Design Summary
- Treat exports as first-class selectable video assets in timeline pickers.
- Keep permissions identical to current upload ownership/sharing rules.
- Reuse existing clip insert model (same timeline schema for source and export clips).
- Add clear UI labeling for export-origin assets.

## Phases

## Phase A — Source Query + API Enablement
- Extend timeline-video source queries to include export uploads:
  - `kind='video'`
  - `status='completed'`
  - `video_role='export'` (plus existing source role behavior)
- Ensure existing API payload includes enough metadata for UI badges:
  - `video_role`
  - filename/title
  - duration
  - thumb/proxy readiness
- Acceptance:
  - API returns user-owned exports in timeline source response.

## Phase B — Picker UI Integration
- Add Exports as an explicit source group in timeline media picker:
  - `Uploads`
  - `My Clips`
  - `Shared Videos`
  - `Exports`
- Add lightweight visual badge/tag on export items.
- Keep filtering/search behavior consistent with existing groups.
- Acceptance:
  - User can browse/select export assets from picker and insert them.

## Phase C — Timeline Insert + Validation
- Confirm exported upload IDs pass timeline validation and normalization.
- Verify duration/source checks are identical to other video assets.
- Ensure clip preview/seek uses existing thumb/proxy/HLS fallback rules.
- Acceptance:
  - Export clip inserts successfully and plays in editor timeline.

## Phase D — UX Safeguards + Diagnostics
- Add clear fallback UI states:
  - proxy not ready
  - thumb not ready
  - deleted/unavailable export
- Add trace/debug tags for source origin when clip is inserted:
  - `app.timeline_asset_origin=export|source|shared|clip`
- Acceptance:
  - Insert diagnostics clearly identify export-origin usage.

## Phase E — Smoke + Docs
- Smoke matrix:
  1. Export appears in Exports picker.
  2. Insert export into new timeline and save.
  3. Re-open project and verify clip persists/playback works.
  4. Search/filter can find export by name.
  5. Missing proxy/thumbnail path degrades gracefully.
- Document source taxonomy and expected behaviors for export-origin assets.

## Completion Notes

- Phase A complete:
  - Added role-aware listing support for video assets.
  - `/api/assets/videos` supports `video_role=source|export|all` (`source` default).
  - `/api/uploads` supports `video_role=source|export` when `kind=video`.
- Phase B complete:
  - Video asset picker now includes `Exports` as a source scope.
  - Existing scopes remain: `Uploads`, `My Clips`, `Shared Videos`.
- Phase C complete:
  - Timeline validation now accepts export-origin videos for both base clips and video overlays.
- Phase D complete:
  - Added readiness fallbacks in picker UI (thumbnail/proxy unavailable states).
  - Added insertion-origin diagnostics (`app.timeline_asset_origin`, `app.timeline_asset_role`) on `assets.videos.used`.
- Phase E complete:
  - Documentation updated for source taxonomy, APIs, and observability tags.

## Risks
1. Duplicate listing across groups (same upload appearing in multiple tabs).
  - Mitigation: strict source-group query predicates + de-dup by upload id.
2. Proxy/thumb race after fresh export.
  - Mitigation: explicit “processing” state and fallback preview.
3. Permission leakage for shared/team contexts.
  - Mitigation: reuse existing upload ACL predicates; no new bypass paths.

## Open Decisions
1. Should exports be shown only in `Exports` tab, or also mixed into `Uploads`?
  - Recommend: `Exports` tab only (clear mental model).
2. Should export assets be mutable in-place (rename/description) from picker?
  - Recommend: no picker edits; keep selection focused.
3. Should export clips be eligible for “shared videos” publishing flow immediately?
  - Recommend: yes if existing sharing rules already cover uploads of role `export`.

## Definition of Done
- Exports are discoverable/selectable in timeline picker.
- Export clips insert and behave like other video clips.
- No permission regressions.
- UX clearly communicates export origin and readiness.
