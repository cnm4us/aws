# Plan 67 — Create Video: System Audio Search (Tags)

## Goal
Add a **Search** tab to the Create Video → Add → Audio picker so users can find **System Audio** using multi‑axis tags:
- Genres
- Moods
- Video Themes
- Instruments

## Key Decisions (confirmed)
- Tabs: **System | Search | My Audio**
- Search semantics:
  - **OR within an axis** (selecting multiple tags inside Genres matches any of them)
  - **AND across axes** (if you pick Genres + Moods, a track must match at least one in each chosen axis)
- If no filters are selected in Search, show **all system audio** (including untagged).
- Free‑text (name/artist) search: **later**

## Scope
### In scope
- Backend: new read-only search endpoint for system audio by tag IDs.
- Frontend: Search UI for selecting tags and showing filtered results.
- Reuse existing system audio cards (play + select) and existing `audio-tags` taxonomy.

### Out of scope (future)
- Text search by name/artist
- Sorting choices (recent/alphabetical) for search results
- “Any tags across all axes” mode

## Backend

### 1) Tags endpoint (already exists)
- `GET /api/audio-tags`
  - returns `{ genres, moods, themes, instruments }` (active only)

### 2) New search endpoint
- `GET /api/system-audio/search`
  - Query params (comma-separated ID lists):
    - `genreTagIds=1,2`
    - `moodTagIds=3,4`
    - `themeTagIds=…`
    - `instrumentTagIds=…`
    - `limit=200` (optional; cap at 200)
    - `cursor=<id>` (optional; for paging later)

If **all** tag arrays are empty → behave like `GET /api/system-audio`.

#### SQL strategy (fast + clear)
Select from `uploads` where `is_system=1 AND kind='audio' AND status IN ('uploaded','completed')` and add one `EXISTS` clause per axis that has any selected tags:
```sql
AND (
  EXISTS (
    SELECT 1
    FROM upload_audio_tags uat
    JOIN audio_tags t ON t.id = uat.tag_id
    WHERE uat.upload_id = u.id
      AND t.kind = 'genre'
      AND t.id IN (…)
  )
)
```
Repeat for mood/theme/instrument only when the corresponding filter list is non-empty.

Return items in the same shape as `listSystemAudio` today, including:
- `genreTagIds`, `moodTagIds`, `themeTagIds`, `instrumentTagIds`

## Frontend (Create Video → Add → Audio)

### 1) Tabs
- Add third tab: **Search**
- Tab behavior:
  - `System`: unchanged (`/api/system-audio`)
  - `My Audio`: unchanged (`/api/create-video/audio/list`)
  - `Search`:
    - If tags not loaded yet: fetch `/api/audio-tags`
    - If no filters selected: show same list as System
    - If filters selected: fetch `/api/system-audio/search?...`

### 2) Search UI
Above the results list:
- Four sections (mobile-friendly):
  - Genres (multi-select)
  - Moods (multi-select)
  - Video Themes (multi-select)
  - Instruments (multi-select)
- Each section shows selectable “chips” or checkboxes (chips recommended for mobile).
- “Clear all” button (optional but recommended).

### 3) Debounced fetch
When filters change:
- Debounce 200–300ms
- Fetch filtered results
- Show a simple “Loading…” state (reuse existing loading UI)

## Testing Checklist
- Search tab loads tags and renders all 4 axes.
- With no filters selected: Search tab shows the same results as System (including untagged).
- With filters in one axis: results match any tag in that axis.
- With filters in multiple axes: results match at least one in each selected axis.
- Selecting an audio from Search adds it to the timeline like System audio does today.

## Open Questions (none blocking)
- UI form factor for tags: chips vs checkboxes (recommend chips).
- Add “Active filters” chips row with remove (nice-to-have).

