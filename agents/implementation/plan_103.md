# Implementation Plan 103: Consolidate Shared Library Into /assets/video

## Goal
Unify shared clip browsing into `/assets/video` via a `Shared Videos` scope, keep create‑clip routed under `/assets/shared/create-clip/:id`, and redirect legacy `/library` routes.

## Decisions (Confirmed)
- `/assets/shared` redirects to `/assets/video?scope=shared`.
- Create‑clip lives at `/assets/shared/create-clip/:id` with `/library/create-clip/:id` redirect.
- Shared filter default is `System`.

## Phase A — Routing + Redirects
1. **Redirect `/library` → `/assets/video?scope=shared`.**
2. **Redirect `/library/create-clip/:id` → `/assets/shared/create-clip/:id`.**
3. **Redirect `/assets/shared` → `/assets/video?scope=shared`.**

## Phase B — `/assets/video` Shared Scope UI
1. **Scope dropdown**
   - Options: `Uploads`, `My Clips`, `Shared Videos`.
   - Persist in URL via `?scope=uploads|mine|shared`.
2. **Shared view in place**
   - When `scope=shared`, render the existing `/library` list UI in place (not a new page).
   - Keep existing search + source filters from `/library`.

## Phase C — Shared Filter Controls
1. **Shared filter**
   - `System` (default) and `Other Users`.
   - Persist in URL with `shared_scope=system|users`.
2. **Empty states**
   - “No system clips yet.”
   - “No shared clips yet.”

## Phase D — Create Clip Routing
1. **Create Clip buttons**
   - Route to `/assets/shared/create-clip/:id`.
2. **Lazy load**
   - Ensure create‑clip bundle is lazy‑loaded to avoid inflating `/assets/video`.

## Phase E — De‑emphasize `/admin/video-library`
1. **Navigation**
   - Remove links pointing to `/admin/video-library` for non‑admin browsing.
2. **Keep ingestion**
   - Admins can still manage “System” content there.

## Notes / QA
- Verify shared scope persists on refresh/back.
- Ensure create‑clip still returns to `/assets/video?scope=shared`.
- Confirm redirects do not break any existing bookmarks.
