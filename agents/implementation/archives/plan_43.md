# Implementation Plan 43: Plain-Text “Story” Overlay (Viewer) + Editor (Creator)

## 1. Overview
Goal: Let creators attach a **plain-text story** (paragraphs + line breaks, no styling) to a video **publication** (production + space) and let viewers expand/collapse that story on the feed slide.

Key UX:
- Bottom overlay shows **creator name** (white, bold) left-aligned.
- If a story exists: show a **chevron up/down** on the right of the name row.
- Tapping the chevron expands a panel that slides upward to ~half the video height; story text becomes scrollable if longer than the window.
- Story text is white, not bold.

Bundle/payload goals:
- Keep the **feed bundle** lean: no markdown, no rich-text libs.
- Avoid shipping the **editor** to feed users by putting it behind route-level code splitting (already true for `/publish`/`/produce`), and by keeping the feed-side story overlay code tiny.
- Avoid inflating the feed API response by **lazy-loading story text** on demand (feed returns `hasStory` only).

## 2. Decisions (Assumptions)
- Story is stored per **publication** (so it can differ across spaces for the same production).
- Story is plain text only; rendering uses `white-space: pre-wrap`.
- Story can be edited by the owner after render; viewers see the latest text.
- “Expand” chevron shows only when `hasStory=true`. If story is later cleared, chevron disappears on refresh.
- Max story length: **2000 chars**.
- Story fetch access: **any logged-in user who can view that feed item** can fetch the story (same access check as viewing the publication/feed).
 - Collapsed view shows a **1–2 line preview** under the creator name.
 - Story background is **transparent** (no dim overlay).

## 3. Open Questions (Confirm)
1) Collapsed view: when `hasStory=true`, do you want the story **hidden until expanded** (recommended, simplest), or show a **1–2 line preview** under the name (with expand for full text)?
2) Creator workflow: should the story be edited from:
   - the **publish** page (`/publish?production=...`) (recommended: story feels like “publication metadata”), or
   - the **produce** page (`/produce?upload=...`) before rendering (requires carrying draft text until a production exists)?

## 4. Implementation Steps

### Step 1) Data model: store story on productions
- Add `space_publications.story_text` (TEXT NULL) and `space_publications.story_updated_at` (DATETIME NULL).
- Backfill: null by default.

### Step 2) API: read + write story
- Add endpoints:
  - Viewer read: `GET /api/publications/:id/story` → `{ storyText }`
    - `requireAuth`
    - Access check: same logic as “can view this publication in a feed/space” (don’t rely on production ownership)
    - Returns `null` if story is empty/missing
  - Creator edit: `PATCH /api/publications/:id/story` with `{ storyText }`
    - `requireAuth` + CSRF required
    - Owner or `site_admin` only (based on publication upload owner)
- Validation:
  - Trim; treat empty/whitespace-only as `NULL`.
  - Enforce max length.

### Step 3) Creator UI: edit story from publish/build flow (code-split)
- Add a “Stories” section on the publish page (`/publish?production=:id`) listing each existing publication for that production:
  - One row per space: space name + story preview (or “None”)
  - Actions: `Edit` and `Clear`
- Add a dedicated editor route (route-based, no modal libs):
  - `/publish/story?publication=:id&from=<encoded>` (or similar)
  - Fullscreen textarea, Save/Cancel
  - On Save → calls `PATCH /api/publications/:id/story`, then returns to `from`.

### Step 4) Feed API: include `hasStory` only
- In feed list queries (global + spaces), return per item:
  - `hasStory: boolean` (computed from `space_publications.story_text IS NOT NULL AND <> ''`)
  - `storyPreview: string | null` (small, e.g. ~200 chars, whitespace-normalized)
- Do **not** include the full story text in the main feed payload.

### Step 5) Feed UI: expand/collapse overlay + lazy fetch
- Update `frontend/src/app/Feed.tsx`:
  - Render chevron button only when `it.hasStory`.
  - Maintain a `storyExpandedFor` state (by `productionUlid` or `publicationId`).
  - On expand: fetch story once and cache in a map:
    - `GET /api/publications/:id/story` (preferred because feed items already have `publicationId` and access checks naturally follow the publication).
  - Story display:
    - `white-space: pre-wrap;`
    - `overflow-y: auto; max-height: 50%;`
  - Animation:
    - CSS transition to slide the block upward (transform/translate).

### Step 6) QA checklist
- Feed:
  - Portrait + landscape: name row always visible; chevron only when story exists.
  - Expand/collapse works; panel scrolls; no accidental swipe conflicts.
- Creator:
  - Add/edit/clear story on publish page; updates reflected in feed after refresh.
