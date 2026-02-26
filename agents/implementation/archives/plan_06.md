# Implementation Plan: Explicit Personal vs Global Publishing Scopes (Phase 1)

## 1. Overview
Goal: Create a clear, explicit separation between publishing to Personal and publishing to the Global Feed (the dedicated Global space), and make publish/unpublish behavior fully checkbox-driven per space.

In scope:
- Updating the Publish UI so users explicitly select Personal, Global Feed, groups, and channels via checkboxes (no “All eligible spaces” shortcut, no hidden cross-posting).
- Treating Personal and Global as separate publication scopes backed by distinct `space_publications` rows when both are selected.
- Replacing the separate Publish/Unpublish actions with a single “Publish” action that applies the difference between the current and desired checkbox state.
- Adjusting backend publish behavior so Personal no longer automatically implies Global visibility.
- Retroactively clearing the “Personal ⇒ Global” coupling for existing data in the current dev environment.

Out of scope (for this phase):
- Changing Global feed interaction rules (likes/comments) beyond what is already implemented.
- Introducing new moderation flows or additional visibility flags.
- New UX for per-space “request Global” flows for channels/groups.

References:
- `agents/features/feature_02.md` — Canonical semantics for Personal, Global Feed, and spaces.
- `frontend/src/app/Publish.tsx` — Current Publish UI and flows.
- `src/features/publications/service.ts` — Publication creation/unpublish logic (including `visible_in_global` behavior).
- `src/features/feeds/service.ts`, `src/features/feeds/repo.ts` — Global feed aggregator.
- `src/db.ts` — `space_publications` schema (`visible_in_space`, `visible_in_global`).

---

## 2. Step-by-Step Plan

1. Simplify Publish UI copy and remove implicit “not yet published” messaging  
   Status: Completed  
   Testing:  
   - In `frontend/src/app/Publish.tsx`, update the “Published To” section to remove the “This video has not been published yet.” text, while still listing any existing publications when present.  
   - Ensure the header “Published To” remains useful as a summary list for spaces where the upload/production is currently published (space name, type, status).  
   - Manually verify that for uploads with no publications the UI simply shows an empty/neutral state (no misleading message about implicit defaults).

2. Rework “Publish To” section to use only per-space checkboxes (Personal, Global, groups, channels)  
   Status: Completed  
   Testing:  
   - Remove the “All eligible spaces” vs “Select spaces individually” radio buttons from `Publish.tsx`; keep only a “Publish To” section with checkboxes.  
   - Ensure the options list includes:  
     - A Personal entry (mapped to the user’s personal space),  
     - A Global Feed entry (mapped to the global/broadcast space),  
     - Group entries (type `group`),  
     - Channel entries (type `channel`).  
   - On initial load, derive checkbox state from `upload.publications` / `pubs` so that each space’s checkbox reflects whether the video is currently published there (`status` in `['pending','approved','published']`).  
   - Default: no boxes are auto-selected; “Publish” is disabled until the user selects at least one space.  
   - Manually verify:  
     - New upload with no publications shows all checkboxes unchecked.  
     - Existing upload with publications shows only the relevant spaces checked.  
     - Toggling checkboxes does not immediately change state on the server until the user clicks “Publish”.

3. Replace separate Publish/Unpublish actions with a single diff-based “Publish” operation  
   Status: Completed  
   Testing:  
   - In `Publish.tsx`, remove the “Unpublish Selection” button and rename the primary action to “Publish” (or similar) that applies changes based on the current checkbox state.  
   - In `handlePublish`, compute two sets:  
     - `currentlyPublished` — spaces where the upload/production is currently published (from `upload.publications` / `pubs`).  
     - `desiredPublished` — spaces whose checkboxes are checked in the UI.  
   - Compute:  
     - `toPublish = desiredPublished \ currentlyPublished`,  
     - `toUnpublish = currentlyPublished \ desiredPublished`.  
   - For uploads:  
     - Call `/api/uploads/:uploadId/publish` with `spaces: toPublish` when `toPublish` is non-empty.  
     - Call `/api/uploads/:uploadId/unpublish` with `spaces: toUnpublish` when `toUnpublish` is non-empty.  
   - For productions:  
     - For each `spaceId` in `toPublish`, POST to `/api/productions/:productionId/publications`.  
     - For each `spaceId` in `toUnpublish`, find the corresponding publication and POST to `/api/publications/:id/unpublish`.  
   - After a successful apply, refresh the upload/production and confirm that:  
     - Checkboxes now reflect the updated server-side state,  
     - Re-clicking “Publish” with unchanged selections is idempotent (no extra publishes/unpublishes),  
     - Trying to “Publish” with no boxes checked results in a clear, user-visible validation message.

4. Make Personal and Global distinct scopes in publication creation (no automatic “Personal ⇒ Global”)  
   Status: Completed  
   Testing:  
  - In `src/features/publications/service.ts`, update both `createFromUpload` and `createFromProduction` so that:  
    - `visible_in_global` is **not** automatically set to `1` when the target space is of type `'personal'`.  
    - `visible_in_global` is set to `1` only when publishing into the explicitly chosen Global Feed space (the space whose slug is `global-feed`).  
  - Ensure that `visible_in_space` still controls inclusion in non-global space feeds; the Global Feed depends only on `visible_in_global` for the `global-feed` space and must not rely on `visible_in_space` for that space.  
  - Verify via targeted tests or manual checks:  
    - Publishing a video to Personal only produces a `space_publications` row with `visible_in_space=1`, `visible_in_global=0`.  
    - Publishing to the Global Feed produces a row where `visible_in_global=1` for the `global-feed` space (the value of `visible_in_space` for that space is not used by Global feed queries).  
    - Publishing to both Personal and Global Feed results in two rows (two `space_publications` entries), each with appropriate `visible_in_space`/`visible_in_global` values for their respective spaces.  
  - Confirm that the Global feed aggregator behavior (`src/features/feeds/repo.ts` / `service.ts`) is unchanged in shape but now only surfaces items with explicit Global publication (i.e., `visible_in_global=1` for the `global-feed` space), independent of `visible_in_space`.

5. Retroactive migration to remove legacy “Personal ⇒ Global” coupling for existing data  
   Status: Completed  
   Testing:  
   - Add a small, idempotent migration in `src/db.ts` (inside `ensureSchema`) or a dedicated script that:  
     - Clears `visible_in_global` for publications that live in Personal spaces where the current design assumed “Personal ⇒ Global” (for example, `UPDATE space_publications sp JOIN spaces s ON sp.space_id = s.id SET sp.visible_in_global = 0 WHERE s.type = 'personal' AND sp.visible_in_global = 1;`).  
   - Run this migration once in the dev environment and verify with `SELECT` queries (via `mysql` or a small script) that:  
     - No personal-space publications remain with `visible_in_global = 1` unless they also have a distinct Global publication row.  
   - Confirm via manual checks:  
     - Global feed contents now only reflect explicitly Global-published items (which, in the current dev state, may be empty or very small).  
     - Personal profile views and space feeds continue to show the right set of videos, unaffected by the cleared `visible_in_global` flags.

---

## 3. Progress Tracking Notes

- Step 1 — Status: Completed.  
- Step 2 — Status: Completed.  
- Step 3 — Status: Completed.  
- Step 4 — Status: Completed.  
- Step 5 — Status: Completed.  
