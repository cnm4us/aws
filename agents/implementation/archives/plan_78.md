# Plan 78 — Consolidate Video Assets + Video Library QoL

## Goal
Unify **asset management** for videos into a single `/assets/video` experience (no separate “video overlay assets”), while keeping **timeline insertion** semantics distinct (add to `video` lane vs `videoOverlay` lane). Add quick, high-value library features: sort, search, favorites, and recents.

## Non-goals (v1)
- No user-generated tag taxonomy / curated categories yet (we’ll keep the schema extensible).
- No advanced filters unless metadata already exists (orientation/hasAudio can be deferred if not present).
- No cross-user shared libraries / quoting in this plan.

---

## Key UX decisions
1) **Assets Management**
   - Only one section: `Library → Assets → Videos` (`/assets/video`).
   - No “Video Overlay” in the library, since it’s not an asset type.

2) **Timeline Add Flow**
   - Still show **two lane choices**:
     - Add → Video (base lane)
     - Add → Video Overlay (PiP lane)
   - Both route to the same picker list under the hood, passing a `lane` hint:
     - `/assets/video?mode=pick&lane=video&project=<id>&return=...`
     - `/assets/video?mode=pick&lane=videoOverlay&project=<id>&return=...`
   - “Select” inserts into the requested lane.

3) **Library QoL**
   - Sort: one dropdown quick-pick.
   - Search: one field matching name + description.
   - Favorites: per-user star + “Favorites only” filter.
   - Recents: show the last 10 videos used in any timeline (per user).

---

## Outstanding questions (please confirm)
1) **Where should Recents appear?**
   - **Confirmed**: a “Recent” section above the main list.

2) **Should Favorites be visible in pick mode?**
   - **Confirmed**: yes, favorites should be visible in pick mode.

3) **Video metadata availability**
   - Do we already store on `uploads`:
     - `durationSeconds`
     - `bytes`
     - `width/height` (or orientation)
     - `hasAudio`
   - **Researched (current schema)**:
     - `duration_seconds`: yes
     - `size_bytes`: yes
     - `width` / `height`: yes
     - `orientation`: yes (enum portrait/landscape)
     - `hasAudio`: **no** (not currently stored)
   - Implications:
     - We can ship sorts for date/name/duration/size now.
     - We can ship an orientation filter now.
     - “Has audio” filter should be deferred (or added later by persisting ffprobe-derived metadata).

4) **Deletion behavior**
   - If a video is referenced by an active timeline: block delete with a friendly error (recommended).
   - If referenced only by exports/productions: block delete or allow? (recommend block for now).

---

## Implementation steps

### Step 1 — Consolidate routes and UI entry points
1) Remove “Video Overlay” from the **Library → Assets** nav.
2) Ensure `/assets/video` is the canonical manage page.
3) Update Create Video “Add” flow:
   - “Video” and “Video Overlay” both route to `/assets/video` in `mode=pick`, with `lane` passed.

### Step 2 — Favorites + recents data model (per user)
**Recommended DB model (per-user, per-upload):**
- Create table `user_upload_prefs`:
  - `user_id` (FK)
  - `upload_id` (FK)
  - `is_favorite` (bool, default false)
  - `last_used_at` (datetime, nullable)
  - PK `(user_id, upload_id)`

Why: favorites/recents are user-specific; do not belong on `uploads`.

### Step 3 — Backend endpoints
1) List videos for the current user:
   - `GET /api/assets/videos`
   - Query params:
     - `q` (search)
     - `sort` (enum)
     - `favoritesOnly=1`
     - `limit/offset` (pagination)
     - `includeRecent=1` (optional; or separate endpoint)
   - Response should include:
     - upload fields (name, description, date, bytes, duration if present, thumb URL)
     - user prefs (isFavorite, lastUsedAt)

2) Toggle favorite:
   - `POST /api/assets/videos/:uploadId/favorite` (or PATCH)
   - Body: `{ isFavorite: boolean }`

3) Mark “used in timeline”:
   - When a video is inserted into the timeline (either lane), update `last_used_at`.
   - Can be done server-side as part of the “insert into project timeline” endpoint logic.

### Step 4 — Frontend: `/assets/video` UX
1) Add UI controls:
   - Search input (debounced).
   - Sort dropdown.
   - Favorites toggle (checkbox/switch).
2) Add “Recent” section (if chosen):
   - Only when `q` is empty and not `favoritesOnly`.
3) Cards:
   - In manage mode: show Edit/Delete (as now).
   - In pick mode: show Select only (consistent with other assets).
   - Add a star icon toggle for favorites (subject to question #2).

### Step 5 — Remove duplicate/legacy “video overlay asset” list behaviors
1) If `/assets/video-overlays` exists, keep route but redirect to `/assets/video` (manage mode) for now.
2) Ensure any “overlay video” selection uses `lane=videoOverlay` param, not a separate asset type.

### Step 6 — Sorting support (as metadata allows)
Implement these sorts in backend (only if fields exist):
- Date: newest/oldest (always)
- Name: A→Z / Z→A (always)
- Duration: short→long / long→short (if duration present)
- Size: small→large / large→small (if bytes present)
- Recent: last_used_at desc (if prefs exists)

### Step 7 — Validation
- Pick mode:
  - Selecting a video inserts into correct lane (`video` vs `videoOverlay`).
  - Favorites/recents do not break “return to timeline”.
- Manage mode:
  - Favorites persist per-user.
  - Recents update after insertion into either lane.
- No regressions for exports/produce/publish flows.

---

## Suggested rollout
1) Do consolidation + basic sort/search first (no DB migration).
2) Add favorites/recents (migration + endpoints).
3) Add duration/size sorts once metadata is confirmed reliable.
