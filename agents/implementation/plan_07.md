# Implementation Plan: Public Profile by User Slug (Phase 1)

## 1. Overview

Goal: Introduce public, shareable profile pages at `/users/:userSlug`, backed by a new editable `users.slug` field that follows the slug rules you outlined, and wire the feed/avatar UX to link into these pages.

In scope (Phase 1):
- Add `users.slug` with strict validation and uniqueness guarantees.
- Support reading profiles by slug for public views.
- Ship a minimal public profile page that shows avatar, display name, and short bio.
- Update existing places that deep-link to user profiles to prefer slug over numeric id when available.
- Allow the user to edit their slug from their profile settings (with validation + clear errors).

Out of scope (later phases):
- Vanity/verification badges, follower counts, or extended profile fields.
- Username/slug history, redirects from old slugs, or “claim old handle” flows.
- Detailed privacy controls for individual profile fields.

References:
- `frontend/src/app/Feed.tsx` — Avatar overlay and existing `/users/:userId` link.
- `frontend/src/app/Profile.tsx` — Logged-in user profile editor (good place for a slug field).
- `src/routes/profiles.ts` — Current profile API surface.
- `src/db.ts` — Schema + ensureSchema migrations.

---

## 2. Slug Rules (as implemented in this phase)

Source of truth is your description; here’s how we’ll encode it:

- Allowed characters:
  - Lowercase `a–z` (first character must be a letter)
  - Digits `0–9` (allowed after the first character)
  - Hyphen `-`
- Disallowed:
  - Uppercase letters, spaces, underscores, periods, emojis, non-ASCII.
  - Consecutive hyphens (`--`).
  - Leading or trailing hyphens.
- Normalization:
  - Stored lowercase; input is trimmed and lowercased before validation.
  - Unicode rejected; only plain ASCII.
- Length:
  - Min 3 characters; max 32 characters.
- Uniqueness:
  - Globally unique across all users, enforced with a unique index on `users.slug`.
- Reserved/blocked slugs:
  - Must match the reserved names defined in `agents/requirements/reserved_slug_names.md` (kept in a single backend constant shared by slug validation and backfill).

Change policy for Phase 1:
- Slugs are **user-editable**, but:
  - We enforce uniqueness + reserved list on each change.
  - We do *not* keep redirect history in this phase; links using an old slug will 404 after a change.
  - We can revisit “slugs as immutable references” (with redirects/history) in a later plan.

---

## 3. Step-by-Step Plan

1. Add `users.slug` column and unique index  
   Status: Completed  
   Tasks:  
   - In `src/db.ts` `ensureSchema`, add:
     - `ALTER TABLE users ADD COLUMN IF NOT EXISTS slug VARCHAR(64) NULL;`
     - `CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_slug ON users (slug);`  
   - Confirm this is idempotent and safe against existing dev data.

2. Implement shared slug validation + reservation checks  
   Status: Completed  
   Tasks:  
   - Add a helper in a shared backend utility (e.g., `src/utils/slug.ts` or `src/features/profiles/slug.ts`) that:
     - Normalizes input (trim, lowercase).
     - Validates allowed characters and length.
     - Rejects disallowed patterns (leading/trailing hyphens, `--`, non-ASCII).
     - Checks against a reserved-slug list.  
   - Return clear error codes like `bad_slug_format`, `slug_too_short`, `slug_reserved`, `slug_taken`.

3. Extend profile service + routes to support slug read/write  
   Status: Completed  
   Tasks:  
   - Backend read:
     - Keep the existing ID-based profile endpoint (e.g., `GET /api/profile/:id`) as the source of truth; do not introduce a combined `:idOrSlug` route.  
     - Preserve existing JSON shape (`profile` with avatar, displayName, bio, memberSince, etc.) and add `slug` to the payload so the frontend can render `/users/:slug` links.  
   - Backend slug lookup:
     - Add a small helper endpoint (e.g., `GET /api/users/slug/:slug`) that:
       - Validates the slug with the helper from Step 2 (including reserved names and first-character rules).  
       - Looks up the user by `users.slug` and returns at least `{ userId, slug }` (or a minimal profile), or 404 if not found.  
       - Does **not** replace `GET /api/profile/:id`; it only resolves slugs to IDs.
   - Backend update slug:
     - Add an authenticated endpoint (either extend an existing profile update route or add `PUT /api/profile/slug`) that:
       - Validates the proposed slug with the helper from Step 2.
       - Enforces uniqueness via DB + graceful “slug taken” error (409/400).
       - Limits editing to the current user (and site admins).

4. Add public profile page at `/users/:slug` (frontend)  
   Status: Completed  
   Tasks:  
   - Frontend route:
     - In `frontend/src/main.tsx`, add a new branch for paths like `/users/:slug` that renders a new `ProfilePublic` component inside `Layout` (e.g., label “Profile”).  
   - New page component:
     - Create `frontend/src/app/ProfilePublic.tsx`:
       - Reads the last path segment from `window.location.pathname` (treat this as `slugOrId`).  
       - If `slugOrId` is all digits, treat it as a legacy numeric user id and call `GET /api/profile/:id` for backward compatibility.  
       - Otherwise, treat it as a slug, call `GET /api/users/slug/:slug` to resolve the user id, then call `GET /api/profile/:id` to fetch the full profile.  
       - Renders:
         - Avatar (from `avatarUrl`).
         - Display name.
         - Short bio / “About” line.
         - Optional “Member since” if you want to re-use that from the overlay.  
       - Handles not-found and error states cleanly (“Profile not found”, etc.).  
   - Keep this page read-only for Phase 1 (no editing here).

5. Update existing links to use slugs where available  
   Status: Completed  
   Tasks:  
   - Feed avatar overlay:
     - In `frontend/src/app/Feed.tsx`, where we currently link to `/users/:userId`, update logic to:
       - Prefer `/users/:slug` when `peekProfile.slug` (or equivalent) is present.
       - Fall back to numeric id route (`/users/:userId`) only if slug is missing (for backward compatibility).  
   - Any other deep links (e.g., future followers lists) should follow the same pattern.

6. Add slug editing UI to logged-in Profile page  
   Status: Completed  
   Tasks:  
   - In `frontend/src/app/Profile.tsx`:
     - Add a “Profile Handle” / “Public URL” field that shows `/users/<slug>` when set.
     - Allow editing the slug (text input) with:
       - Client-side format hints (e.g., `a–z, 0–9, '-' only; 3–32 chars`).
       - On submit, call the slug update endpoint from Step 3.
       - Display server-side validation errors (reserved, taken, etc.).  
   - Ensure this form is only shown when the user is editing *their own* profile (which is already how the page is used).

7. Backfill slugs for existing users (dev-only for now)  
   Status: Completed  
   Tasks:  
   - (Handled manually for this environment; no dedicated backfill script added in code since there are only two users.)  
   - Strategy:
     - Prefer slugified `display_name`; fallback to slugified email local-part; fallback to `user-<id>`.
     - Enforce reserved word and uniqueness: on collision, append `-2`, `-3`, etc.
   - For this dev environment with a single test user, keep the logic simple but robust enough to reuse later.

---

## 4. Progress Tracking Notes

- Step 1 — Status: Completed.  
- Step 2 — Status: Completed.  
- Step 3 — Status: Completed.  
- Step 4 — Status: Completed.  
- Step 5 — Status: Completed.  
- Step 6 — Status: Completed.  
- Step 7 — Status: Completed (manual backfill by developer; no script).  
