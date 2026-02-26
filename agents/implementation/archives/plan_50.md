# plan_50: Production default story with per-space overrides

## Goal
Add a **production-level default story** that can be applied to all space publications by default, while still allowing **per-space story overrides** (existing behavior). When the production default story changes, update only publications that are still “Using default”.

## Why
Creators often publish the same production to multiple spaces and want a single story by default, but still need the option to customize the story per space.

## Non-goals (for this plan)
- Changing story display UX on the feed beyond consuming the existing `story_text`/`story_preview`.
- Adding story formatting (plain text only, keep current rules).
- Backfilling stories for historical publications beyond the “on publish” defaulting rule and “update default” rule.

## Current state (baseline)
- Stories are stored per publication in `space_publications.story_text` (+ `story_updated_at`).
- Publish UI supports per-space story editing (space-specific).
- Feed reads `has_story/story_preview` from `space_publications.story_text`.

## Proposed behavior
### Data model
- Add `productions.default_story_text` (nullable `TEXT`) + `productions.default_story_updated_at` (`DATETIME NULL`).
- Add `space_publications.story_source` enum-ish string:
  - `'production'` = this publication is currently using the production default story
  - `'custom'` = this publication has been customized for this space

### Rules
1) **On publish to a new space**
   - If `productions.default_story_text` is non-empty:
     - set `space_publications.story_text = productions.default_story_text`
     - set `space_publications.story_source = 'production'`
   - Else: keep `story_text = NULL` and `story_source = 'production'` or `'custom'` (recommend `'production'` only when the story is derived from production; otherwise `'custom'`).

2) **Editing a space story**
   - When a user edits/saves a story for a specific publication:
     - set `story_text = <new text>`
     - set `story_source = 'custom'`

3) **Reset space story to default**
   - Add a “Reset to default” action per publication:
     - set `story_text = productions.default_story_text` (or NULL if empty)
     - set `story_source = 'production'`

4) **Updating the production default story**
   - When the production default story changes:
     - update only publications for that production where `story_source = 'production'`
     - leave `story_source = 'custom'` untouched

## API changes
### Production story endpoints (new)
- `GET /api/productions/:id/story`
  - returns `{ storyText: string | null, updatedAt: string | null }`
- `POST /api/productions/:id/story`
  - body: `{ storyText: string | null }` (plain text, max 2000 chars)
  - writes `productions.default_story_text`, `default_story_updated_at`
  - cascades update to `space_publications` with `story_source='production'`

### Publication story changes (existing + tweak)
- Existing: `POST /api/publications/:id/story` (or whatever is currently used by `PublishStory`)
  - ensure it sets `space_publications.story_source='custom'` on save (even if empty string is saved; recommended to normalize empty to NULL)

### Publication reset endpoint (new)
- `POST /api/publications/:id/story/reset`
  - loads production default story
  - sets `story_text` to default (or NULL) and `story_source='production'`

## DB migration
1) `ALTER TABLE productions ADD COLUMN default_story_text TEXT NULL;`
2) `ALTER TABLE productions ADD COLUMN default_story_updated_at DATETIME NULL;`
3) `ALTER TABLE space_publications ADD COLUMN story_source VARCHAR(32) NOT NULL DEFAULT 'custom';`
4) Backfill:
   - Set `story_source='custom'` for all existing rows (default already does this).

## UI changes
### Publish page: production default story
On `/publish?production=:id`:
- Add a new card section above the per-space list:
  - Title: `Default Story (for all spaces)`
  - Textarea (plain text, max 2000 chars) + Save button
  - Helper text: “Used as the story for newly published spaces. Editing it updates spaces still using the default.”

### Publish page: per-space story status + reset
For each space row / publication:
- Show an indicator:
  - “Using default” if `story_source==='production'`
  - “Customized” if `story_source==='custom'`
- Keep existing “Edit story” flow.
- Add “Reset to default” action (visible when `story_source==='custom'`).

### Produce page (optional UX, not required)
No changes required for correctness. (A later enhancement could add a “Default story” entry during creation, but production doesn’t exist yet on `/produce`.)

## Access control
- Same as publish access today:
  - A user can set production default story only if they can manage that production.
  - A user can edit/reset a publication story only if they can manage that publication.

## Implementation steps
1) DB migration + type updates
   - Update `src/db.ts` migration block for `productions` + `space_publications`.
   - Add/extend types in `src/features/productions/types.ts` and `src/features/publications/types.ts`.

2) Repo + service work
   - Add production story get/set in `src/features/productions/repo.ts` + `service.ts`.
   - Update publication `updateStory()` to set `story_source='custom'`.
   - Add `resetStoryToProductionDefault()` in publications service.
   - Update publish/create-publication codepath to apply default story on insert.

3) Routes
   - Add `/api/productions/:id/story` routes.
   - Add `/api/publications/:id/story/reset`.

4) UI
   - Update `frontend/src/app/Publish.tsx` to include Default Story editor.
   - Update `frontend/src/app/PublishStory.tsx` (or whichever component is used) to:
     - display source status
     - call reset endpoint

5) Manual test matrix
   - Set production default story, publish to 2 spaces → both get same story.
   - Customize story in one space → that one becomes “Customized”; other remains “Using default”.
   - Edit production default story → only “Using default” space updates.
   - Reset customized space → it reverts to new default and becomes “Using default”.
   - Clear production default story → “Using default” spaces clear story text; customized spaces remain.
