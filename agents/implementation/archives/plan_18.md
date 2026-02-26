# Implementation Plan: Global Feed “Jump to Space” Modal (No Likes/Comments on Global)

## 1. Overview

Goal: On the **Global Feed only**, remove Like + Comment actions and replace them with a “Jump” action that opens a modal listing the **other spaces (groups/channels)** where the same video is published (by `production_id`). Selecting a space navigates to that space’s feed.

In scope:
- UI:
  - Hide Like + Comment on Global Feed items.
  - Add “Jump” icon action on Global Feed items.
  - Add a modal that loads and shows target spaces for a publication.
- API:
  - Add an endpoint to list “other spaces for this production” based on `production_id`, filtered to `spaces.type IN ('group','channel')`, excluding the Global Feed space, and excluding unpublished/unviewable entries.

Out of scope:
- Membership gating UI (member vs non-member interaction) and join flow.
- Age verification restrictions (but design API so we can add gating later).
- Any fallback matching by `upload_id` (explicitly not used).

Assumptions:
- Global Feed is represented as a space (channel) with slug `global` or `global-feed` (use `spacesRepo.findGlobalSpaceCandidate()` to resolve its ID).
- Feed items include `publicationId`; `production_id` is obtained from the publication record (no fallback).
- “Published to a space” means `space_publications.status = 'published'` (so we do not leak pending/unpublished targets).

---

## 2. Step-by-Step Plan

1. Inventory current Global Feed action UI and determine insertion point  
   Status: Completed (2025-12-29)  
   Work:
   - Find where Like/Comment actions are rendered for feed items.
   - Find how the app determines “Global Feed active” vs “space feed active”.
   - Decide the exact UI placement for the Jump icon (replace likes/comments cluster).
   Testing:
   - Canonical (expected): `rg -n "Like|Comment|likesCount|commentsCount|onLike|onComment" frontend/src/app/Feed.tsx -S` → identify action rendering section.  
   - Record actual output: `agents/implementation/tests/plan_18/step_01_inventory.md`  
   Checkpoint: Wait for developer approval before proceeding.

2. Add API endpoint: list jump targets by publication (production_id)  
   Status: Completed (2025-12-29)  
   Work:
   - Add `GET /api/publications/:id/jump-spaces` (require auth, like `/api/feed/global`):
     - Load the publication to get `production_id` and current `space_id`.
     - If `production_id` is null → return `{ items: [] }` (UI will still show the Jump icon and display “Not published to any spaces yet”).
     - Resolve the Global Feed space id via `spacesRepo.findGlobalSpaceCandidate()` and exclude it.
     - Query `space_publications` joined to `spaces` for the same `production_id`:
       - include only `spaces.type IN ('group','channel')`
       - include only `space_publications.status = 'published'`
       - include only `space_publications.visible_in_space = 1`
       - exclude the publication’s current `space_id` (avoid listing the space you’re currently viewing, including the global feed)
     - Return `items` with enough fields to build links:
       - `spaceId`, `spaceUlid` (optional), `spaceName`, `spaceSlug`, `spaceType`
     - Sort by `spaceName` for stable UX.
   Testing:
   - Canonical (expected): `./scripts/auth_curl.sh --profile super get /api/publications/1/jump-spaces` → `HTTP 200` and JSON has `items[]`.  
   - Canonical (expected): `curl -i http://localhost:3300/api/publications/1/jump-spaces` (no auth) → `HTTP 401/403`.  
   - Record actual output: `agents/implementation/tests/plan_18/step_02_api.md`  
   Checkpoint: Wait for developer approval before proceeding.

3. Create Jump modal component (lazy-loaded)  
   Status: Completed (2025-12-29)  
   Work:
   - New component `frontend/src/app/JumpToSpaceModal.tsx`:
     - Props: `open`, `publicationId`, `onClose`
     - On open: fetch `/api/publications/:id/jump-spaces`
     - Render a list of links:
       - groups → `/groups/:slug`
       - channels → `/channels/:slug`
      - Basic empty states:
        - loading
        - no targets: show “Not published to any spaces yet”
        - error
   Testing:
   - Manual: open a Global Feed item, click Jump, see modal with links.  
   - Record notes: `agents/implementation/tests/plan_18/step_03_modal.md`  
   Checkpoint: Wait for developer approval before proceeding.

4. Update Global Feed item actions: remove Like/Comment, add Jump  
   Status: Completed (2025-12-29)  
   Work:
   - In `frontend/src/app/Feed.tsx`:
     - Detect Global Feed billboard mode:
       - `feedMode.kind === 'global'`, OR
       - active space slug is `global` / `global-feed` (e.g. `/channels/global-feed`).
     - When global:
       - do not render Like/Comment actions
       - do not render Like/Comment counts (they are part of the same action cluster)
       - render Jump action (always present) which opens the modal for that item’s `publicationId`
     - When not global: preserve existing Like/Comment behavior.
   Testing:
   - Manual: on Global Feed, Like/Comment hidden and Jump present; in a space feed, Like/Comment still present.  
   - Record notes: `agents/implementation/tests/plan_18/step_04_feed_ui.md`  
   Checkpoint: Wait for developer approval before proceeding.

5. Build verification (ensure minimal bundle impact)  
   Status: Completed (2025-12-29)  
   Work:
   - Ensure the modal is lazy-loaded so the core feed chunk stays small.
   Testing:
   - Canonical (expected): `npm run web:build` → success.  
   - Record notes: `agents/implementation/tests/plan_18/step_05_build.md`  
   Checkpoint: Wait for developer approval before proceeding.

6. Documentation touch-up (if needed)  
   Status: Completed (2025-12-29)  
   Work:
   - If a new endpoint is added, update `/README.md` “Useful Pages / API” section (minimal).
   Testing:
   - None (doc-only).  
   Checkpoint: Wait for developer approval before proceeding.
