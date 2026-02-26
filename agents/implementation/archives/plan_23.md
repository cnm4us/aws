# Implementation Plan 23: Logo Configurations (Branding Presets)

## 1. Overview

Goal: Add a **Logo Configurations** feature (aka “branding presets”) so users can define *how* a logo should appear on videos during production (position/size/opacity/timing/fade), without baking behavior into the logo asset itself.

In scope:
- New **Logo Configuration** data model (separate from logo uploads).
- CRUD API for logo configurations (user-owned initially).
- SPA page to list/create/edit/duplicate/archive logo configurations with a **visual preview** (mock/simulated overlay is OK).
- Add **Logo Configs** navigation button alongside Videos/Logos/Audio on `/uploads`.
- Auto-create a default config (“Standard watermark”) the first time a user uploads a logo.
- Integrate **Logo Config selection** into `/produce` (persist selection for future rendering).

Out of scope:
- MediaConvert watermark rendering implementation (pipeline changes).
- Space/channel-owned logo configs (if desired later) beyond schema “future-proofing”.

---

## 2. Data Model

### 2.1 New table: `logo_configurations`

Proposed schema (MySQL):
- `id BIGINT PRIMARY KEY AUTO_INCREMENT`
- `owner_user_id BIGINT NOT NULL` (user-owned for now)
- `name VARCHAR(120) NOT NULL`
- `position ENUM('top_left','top_right','bottom_left','bottom_right','center') NOT NULL`
- `size_pct_width TINYINT NOT NULL` (1–100, interpreted as % of video width)
- `opacity_pct TINYINT NOT NULL` (0–100)
- `timing_rule ENUM('entire','start_after','first_only','last_only') NOT NULL`
- `timing_seconds INT NULL` (required for non-`entire`; stored as seconds)
- `fade ENUM('none','in','out','in_out') NOT NULL` (type only; no duration field yet)
- `created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
- `archived_at TIMESTAMP NULL` (soft delete/archive)

Indexes:
- `INDEX(owner_user_id, archived_at, id)`

Future-proofing notes:
- If we later want “belong to a channel/space”, we can add `space_id BIGINT NULL` and enforce “either owner_user_id or space_id” in service validation (MySQL CHECK constraints are limited).
- Versioning can be added later with `version INT` and a separate history table without changing the UI/API shape.

### 2.2 Defaults

Default preset (generated automatically on first logo upload per user):
- Name: `Standard watermark`
- Position: `bottom_right`
- Size: `small` → store `size_pct_width = 15`
- Opacity: `35`
- Timing: `entire`
- Fade: `none`

Size presets (UI labels → stored numeric):
- Tiny: `10`
- Small: `15`
- Medium: `22`
- Large: `30`

---

## 3. Backend Changes

### 3.1 Repository/service module

Add `src/features/logo-configs/`:
- `repo.ts`: basic SQL CRUD for `logo_configurations`
- `service.ts`: validation, ownership checks, “ensure default” helper
- `dto.ts` (optional): map DB rows → API DTO
- `mediaconvert.ts` (translation layer, *high-level only*): `logoConfigToOverlayParams(config)` returning a neutral overlay object (NOT raw MediaConvert JSON)

Validation rules:
- `name`: required, trimmed, 1–120
- `position`: required enum
- `size_pct_width`: 1–100 (UI will constrain to a small set of presets)
- `opacity_pct`: 0–100
- `timing_rule`: required enum
- `timing_seconds`:
  - required for `start_after|first_only|last_only`
  - must be `>= 0` and `<= 3600`
- `fade`: required enum

Soft delete:
- “Delete” in UI sets `archived_at = NOW()`; list excludes archived by default.

### 3.2 Routes / API

Add routes (all `requireAuth`):
- `GET /api/logo-configs` → list (default excludes archived; optional `?include_archived=1`)
- `POST /api/logo-configs` → create
- `GET /api/logo-configs/:id` → fetch detail
- `PATCH /api/logo-configs/:id` → update
- `POST /api/logo-configs/:id/duplicate` → clone (new name like “Copy of …”)
- `DELETE /api/logo-configs/:id` → archive

### 3.3 Production integration (/produce → /api/productions)

Add `logoConfigId` support:
- Extend `POST /api/productions` schema to accept:
  - `logoConfigId: number | null` (optional)
- On create:
  - validate the config exists, is not archived, and is owned by the current user
  - store BOTH:
    - `logoConfigId` (reference)
    - `logoConfigSnapshot` (copy of fields) inside `productions.config`

Rationale:
- Allows users to edit a logo config later without mutating past productions’ recorded intent (“no schema regret”).

### 3.3 Create default config on first logo upload

Hook point (recommended):
- In `uploadsSvc.createSignedUpload()` when `kind === 'logo'` and we have an `ownerId`, call `logoConfigsSvc.ensureDefaultForUser(ownerId)`:
  - If user has 0 non-archived logo configs, insert the default config.
  - Otherwise no-op.

---

## 4. Frontend Changes

### 4.1 Navigation: add “Logo Configs” on Uploads page

On `frontend/src/app/Uploads.tsx`:
- Update tab row to: `Videos | Logos | Logo Configs | Audio`
- “Logo Configs” links to a new SPA route (proposed): `/logo-configs`

Also update `frontend/src/ui/routes.ts`:
- Add a loader `loadLogoConfigs()`
- Update `prefetchForHref()` to prefetch on `/logo-configs`

And update `frontend/src/main.tsx`:
- Add `else if (path.startsWith('/logo-configs')) { ... }` rendering a new `LogoConfigsPage`.

### 4.2 New page: `/logo-configs`

Create `frontend/src/app/LogoConfigs.tsx`:

Page layout:
- Header: “Logo Configurations”
- Primary CTA: “New configuration”
- List of existing configs as cards:
  - Name
  - Summary chips (Position / Size / Opacity / Timing / Fade)
  - Actions: Edit, Duplicate, Archive

Create/edit form (same page, modal, or side panel):
- Required fields with friendly controls:
  - Name (text)
  - Position (5-button picker)
  - Size (Tiny/Small/Medium/Large → stored as numeric pct)
  - Opacity (slider 0–100)
  - Timing rule (radio group) + seconds input when needed
  - Fade (radio group)
- Defaults pre-filled for new configs.

Preview behavior (mock/simulated):
- Render a fixed-aspect “video frame” placeholder.
- Draw a “logo” box overlay whose size/opacity/position reflect the config.
- (Optional) let user toggle portrait/landscape preview frame.
- Do NOT require selecting a logo asset here.

### 4.3 `/produce`: add Logo Config selection

On `frontend/src/app/Produce.tsx`:
- Load logo configs for the current user (e.g. `GET /api/logo-configs`)
- Add a “Logo Config” section:
  - radio list or select dropdown showing config name + summary chips
  - default to `Standard watermark` if present; otherwise “None”
- When producing, send `logoConfigId` (or null) alongside `logoUploadId` and `musicUploadId`

---

## 5. Testing / Verification

After each step:
- `npm run web:build` → succeeds

Canonical API tests (expected):
- `./scripts/auth_curl.sh --profile user login`
- `./scripts/auth_curl.sh --profile user get /api/logo-configs` → `HTTP 200` JSON array
- `./scripts/auth_curl.sh --profile user post /api/logo-configs -d '{...}'` → `HTTP 201` `{ config: { id, name, ... } }`
- `./scripts/auth_curl.sh --profile user patch /api/logo-configs/:id -d '{ opacity_pct: 40 }'` → `HTTP 200`
- `./scripts/auth_curl.sh --profile user post /api/logo-configs/:id/duplicate` → `HTTP 201`
- `./scripts/auth_curl.sh --profile user delete /api/logo-configs/:id` → `HTTP 200` (and subsequent list excludes it)

Manual UX checks:
- `/uploads?kind=logo` shows “Logo Configs” button and it navigates to `/logo-configs`
- `/logo-configs` loads and renders preview; create/edit/duplicate/archive works
- Uploading first logo for a new user auto-creates “Standard watermark”
- `/produce?upload=<id>` lets user select logo config, and production create persists `logoConfigId` + `logoConfigSnapshot` in production config

---

## 6. Step-by-Step Plan

1. Add DB table + repo/service scaffolding for logo configs  
   Status: Completed  
   Testing (expected):
   - Run migration successfully.
   - `./scripts/auth_curl.sh --profile user get /api/logo-configs` → `HTTP 200 []`.  
   Checkpoint: Wait for developer approval before proceeding.

2. Add authenticated CRUD API routes for logo configs  
   Status: Completed  
   Testing (expected):
   - Create/update/list/duplicate/archive flows return `HTTP 2xx` and enforce ownership (403 for other users).  
   Checkpoint: Wait for developer approval before proceeding.

3. Add default “Standard watermark” creation on first logo upload  
   Status: Completed  
   Testing (expected):
   - After initiating a logo upload for a new user, `GET /api/logo-configs` returns at least 1 config with expected defaults.  
   Checkpoint: Wait for developer approval before proceeding.

4. Build `/logo-configs` SPA page (list + create/edit + preview)  
   Status: Completed  
   Testing (expected):
   - `npm run web:build` succeeds.
   - Manual: create/edit/duplicate/archive works and preview updates.  
   Checkpoint: Wait for developer approval before proceeding.

5. Integrate Logo Config selection into `/produce` + persist snapshot  
   Status: Completed  
   Testing (expected):
   - Producing with `logoConfigId` stores `logoConfigId` and `logoConfigSnapshot` in `productions.config`.  
   Checkpoint: Wait for developer approval before proceeding.

6. Add “Logo Configs” button/tab to `/uploads` nav and hook SPA routing/prefetch  
   Status: Pending  
   Testing (expected):
   - Manual: `/uploads?kind=logo` → “Logo Configs” navigates correctly.  
   Checkpoint: Wait for developer approval before proceeding.

---

## 7. Open Questions

None (requirements confirmed for Plan 23).
