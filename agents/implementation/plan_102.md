# Implementation Plan 102: Unify Asset Browsing + Video Scope Filters

## Goal
Make `/assets/*` the single canonical asset browsing UI, add the “Uploads / System Clips / My Clips / Other Users” scope filters to `/assets/video`, and de‑emphasize `/uploads` as a browsing destination while preserving upload flows.

## Phase A — Video Scope Filters in `/assets/video`
1. **Expose scope tabs on `/assets/video`**
   - Add the same scope UI used in the “Add Assets” flow (`Uploads / System Clips / My Clips / Other Users`) to the manage view.
   - Keep existing search + sort controls.
2. **Wire scope to API**
   - Reuse existing clip list endpoint for system/my/other clips (same as “Add Assets” flow).
   - Uploads view continues to use `/api/assets/videos`.
3. **Confirm UX details**
   - Default scope: `Uploads` (or `My Clips` if you want to bias toward reusable clips).
   - Sorting: keep “Recently Used” default.

## Phase B — De‑emphasize `/uploads` as a browsing destination
1. **Remove `/uploads` from navigation**
   - Ensure no direct navigation links point to `/uploads`.
2. **Optional: Deprecation redirect**
   - If a user visits `/uploads`, either:
     - redirect to `/assets`, or
     - show a small message + “Go to Assets”.
3. **Preserve upload flows**
   - Keep `/uploads/new?...` unchanged, since `/assets/*` relies on it.

## Phase C — Polish + Consistency
1. **Help text**
   - Update subtitle on `/assets/video` to mention scope filtering.
2. **Empty states**
   - Ensure empty states make sense for each scope (e.g., “No system clips yet”).
3. **URL state**
   - Persist scope in query string (optional, but consistent with search/filters).

## Open Questions / Decisions
1. Default scope in `/assets/video`: `Uploads` or `My Clips`?
2. Should scope be persisted in URL (recommended) so it survives refresh/back?
3. For `/uploads`, redirect vs static deprecation message?
