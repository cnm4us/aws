# plan_51: System audio metadata (Artist + Genre + Mood) + picker filters

## Goal
Extend **system audio uploads** with richer metadata and allow creators to filter/select audio by:
- Name (existing)
- Artist (new)
- Genre (multi-select, curated list)
- Mood (multi-select, curated list)

## Why not ENUM
Avoid DB `ENUM` for growing sets (genre/mood) because updates require schema migrations and are painful over time. Use a **tag taxonomy** instead.

## Non-goals (for this plan)
- User-uploaded audio (still site_admin only).
- Complex recommendation systems / “similar tracks”.
- Full-text search infrastructure (stick to SQL LIKE for now).

## Data model
### New columns
- `uploads.artist` (`VARCHAR(255) NULL`)
  - only meaningful for `uploads.kind='audio'` and `is_system=1`

### New tables
1) `audio_tags`
- `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
- `kind ENUM('genre','mood') NOT NULL`
- `name VARCHAR(120) NOT NULL`
- `slug VARCHAR(140) NOT NULL` (lowercase, hyphenated; unique per kind)
- `sort_order INT NOT NULL DEFAULT 0`
- `archived_at TIMESTAMP NULL DEFAULT NULL`
- indexes:
  - unique `(kind, slug)`
  - index `(kind, archived_at, sort_order, id)`

2) `upload_audio_tags` (join table)
- `upload_id BIGINT UNSIGNED NOT NULL`
- `tag_id BIGINT UNSIGNED NOT NULL`
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- unique `(upload_id, tag_id)`
- indexes:
  - `(upload_id, tag_id)`
  - `(tag_id, upload_id)`

## Admin UI
### `/admin/audio` list
- Add Artist display under Name (optional).
- Add “Edit” -> goes to edit screen (existing).

### `/admin/audio/:id` edit
Add fields:
- Artist: text input
- Genres: multi-select (checkbox list or chip picker)
- Mood: multi-select

Admin can:
- Set artist
- Select/unselect tags
- Save

### `/admin/audio-tags` (new)
Site admin taxonomy manager:
- Tabs: Genres | Moods
- List existing tags, create new tags
- Archive/unarchive tags (so old usage remains but tag isn’t offered)

## Creator UI (audio picker)
On `/produce?upload=...&pick=audio`:
- Keep current list + audio player
- Add filters section:
  - Search: Name/Artist (single input)
  - Genres multi-select (from active tags)
  - Mood multi-select (from active tags)
  - Sort: Recent | Alphabetical (existing)
- Filtering behavior:
  - Name/Artist: substring match against upload name OR artist
  - Genre/Mood:
    - AND across kinds (if user selects both a genre and a mood, must match both)
    - OR within a kind (selecting multiple genres means match any selected genre)

## Backend API
### Admin endpoints
- `GET /api/admin/audio-tags?kind=genre|mood`
- `POST /api/admin/audio-tags` body `{ kind, name }`
- `PATCH /api/admin/audio-tags/:id` body `{ name?, archived? }`

- `GET /api/admin/audio/:uploadId` (existing or add) includes:
  - `artist`
  - `genres` (tag ids + names)
  - `moods`
- `PATCH /api/admin/audio/:uploadId` body:
  - `artist: string|null`
  - `tagIds: number[]` (complete set to replace existing)

### Creator endpoints
Enhance existing audio list endpoint (whatever `/api/uploads?kind=audio` or similar) to return:
- `artist`
- `tagIds` (or `{ genres: [], moods: [] }`)

Also add:
- `GET /api/audio-tags` (active only, for pickers)

## Migration
In `src/db.ts`:
- Add `uploads.artist` if missing.
- Create `audio_tags` and `upload_audio_tags`.

Seed:
- No default tags required; admin will add over time.

## Permissions
- Only site_admin can manage:
  - `/admin/audio-tags`
  - editing system audio metadata
- Any logged-in user can **view** tags for filtering in `/produce` audio picker.

## Implementation steps
1) DB migration + types
   - Add new tables + columns in `src/db.ts`
   - Add repo/service types for tags and audio metadata

2) Admin taxonomy + audio edit plumbing
   - Implement `audio-tags` CRUD (service + routes)
   - Update admin audio edit to save artist + tags

3) Creator picker filters
   - Fetch tag catalog
   - Display filters (search, genres, moods)
   - Filter list client-side (OK for dozens/hundreds of tracks)
   - Ensure it doesn’t bloat user feed bundle (keep under `/produce` chunk)

4) Manual testing
   - Create tags (genre/mood)
   - Assign tags + artist to a system audio track
   - Verify `/produce` audio picker can filter by:
     - artist substring
     - genre only
     - mood only
     - genre+mood combination
