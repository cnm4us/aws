# Implementation Plan: Profile Route and UI (Phase 1)

## 1. Overview
Goal: Add a dedicated `/profile` route and Profile UI that lets authenticated users view and edit their public Profile (identity) in a “ceremonial” way, wired into the existing Menu Selector as a Profile menu, without exposing any identification data or credibility signals.

In scope:
- SPA route and React page at `/profile` using the existing frontend layout system.
- A minimal Profile form that reads/writes to the new Profile APIs (`/api/profile/me`), with clear “public profile” messaging and explicit Save.
- Integration with the universal menu: add a Profile menu entry in the Menu Selector that links to the Profile page.

Out of scope (for this phase):
- Per-space credibility labels or explanations in the Profile UI.
- Identification/verification flows or settings pages.
- Rich multi-page profile sections (we will start with a single Profile page, with room to expand later).

References:
- `agents/features/feature_01.md` — conceptual boundaries for Profile vs Identification vs Credibility.
- `agents/implementation/plan_02.md` — Profiles backend schema and APIs.
- `frontend/src/main.tsx`, `frontend/src/ui/Layout.tsx` — SPA routing and layout.
- `frontend/src/menu/ContextPicker.tsx`, `frontend/src/menu/ContextDrawer.tsx`, `frontend/src/menu/contexts/*` — Menu Selector and context menus.
- `src/routes/profiles.ts` — Profile APIs (`/api/profile/me`, `/api/profile/:userId`) and legacy `/api/profiles`.

## 2. Step-by-Step Plan

1. Add `/profile` SPA route and loader  
   Status: Completed  
   Testing: Update the frontend routing so that visiting `/profile` renders a SPA page using `Layout` with label “Profile”. Add a lazy loader (e.g., `loadProfile`) in `frontend/src/ui/routes.ts` and a branch in `frontend/src/main.tsx` similar to `/uploads` and `/publish`. Verify manually that navigating directly to `/profile` loads the React app, shows the shared nav, and does not break existing routes.

2. Implement minimal Profile page component  
   Status: Completed  
   Testing: Create `frontend/src/app/Profile.tsx` (or equivalent) that:  
   - On mount, fetches `/api/me` to get the current session and `/api/profile/me` to load the existing Profile, pre-filling `displayName` from Profile when present or from `/api/me` as a fallback when no Profile exists.  
   - Renders a simple form with fields: `displayName` (required), `avatarUrl` (URL string), `bio` (textarea), `isPublic` toggle, and `showBio` toggle.  
   - Shows clear “Public Profile” labeling and a short warning (e.g., “Changes are public and persistent”).  
   - On Save, POSTs to `/api/profile/me`, handles `display_name_required` with a user-friendly error, and shows a small success confirmation.  
   Confirm via manual testing that the page works end-to-end on `/profile`, gracefully handles missing profiles, and never shows identification data (email, phone, KYC, etc.).

3. Add Profile context to the Menu Selector  
   Status: Completed  
   Testing: Extend the universal menu so Profile has its own context:  
   - Update `ContextId` in `frontend/src/menu/ContextPicker.tsx` to include `'profile'` (or similar) and add a “Profile” item to the Menu Selector list alongside My Assets, Channel Changer, Admin, Help, Messages, Settings.  
   - Implement a new `frontend/src/menu/contexts/ProfileMenu.tsx` that contains at least one link to `/profile` (e.g., “Edit Profile”), using the same prefetch and onNavigate patterns as other menus.  
   - Update `SharedNav` (and any title mapping) so that when the active context is Profile, the drawer title shows “Profile” and the body renders `ProfileMenu`.  
   Verify that:  
   - The 4-square menu selector can switch to the Profile menu.  
   - From the Profile menu, clicking “Edit Profile” navigates to `/profile` and closes the drawer.  
   - Other existing contexts (assets, channel, admin, help) remain unchanged.

4. Wire Profile route into menu prefetching and navigation helpers  
   Status: Completed  
   Testing: Update `frontend/src/ui/routes.ts` (or equivalent prefetch helper) so that hovering/focusing Profile links triggers prefetch of the Profile page bundle. Confirm via dev tools or network inspection that navigating to `/profile` after prefetch is fast and that no other routes’ prefetch logic is affected.

5. UX and behavior validation pass  
   Status: Completed  
   Testing:  
   - As an authenticated user, navigate to `/profile` via direct URL and via the Menu Selector → Profile menu; ensure the same page and data appear.  
   - Confirm that editing and saving the Profile shows clear public-identity messaging and that the change persists (via `GET /api/profile/me` and `/api/profile/:userId`).  
   - Confirm that unauthenticated users hitting `/profile` are redirected or receive an appropriate error (based on existing auth behavior), and that `/api/profile/:userId` only returns public profiles.  
   - Check that no identification fields are rendered in the Profile UI and that legacy `/api/profiles` behavior is unaffected.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed (added a lazy-loaded `/profile` SPA route in `frontend/src/main.tsx` using `Layout` and a placeholder `Profile` page component, wired via `loadProfile` in `frontend/src/ui/routes.ts`).  
- Step 2 — Status: Completed (implemented `frontend/src/app/Profile.tsx` as a real Profile form that loads `/api/me` and `/api/profile/me`, pre-fills displayName from Profile or `/api/me`, allows editing of display name, avatar URL, bio, and public/visibility toggles, and posts changes to `/api/profile/me` with clear public-profile messaging and no identification data).  
- Step 3 — Status: Completed (extended the Menu Selector with a `profile` context in `frontend/src/menu/ContextPicker.tsx`, added `ProfileMenu` under `frontend/src/menu/contexts/ProfileMenu.tsx` with a link to `/profile`, and updated `frontend/src/ui/SharedNav.tsx` so the drawer can switch to the Profile menu and navigate to the Profile page).  
- Step 4 — Status: Completed (updated `frontend/src/ui/routes.ts` so Profile links trigger prefetch of the Profile bundle, keeping behavior consistent with other SPA routes).  
- Step 5 — Status: Completed (validated that `/profile` loads via direct URL and Profile menu, edits persist via `/api/profile/me` and public `/api/profile/:userId`, unauthenticated users see an appropriate message, and no identification data appears in the Profile UI; legacy `/api/profiles` behavior is preserved).  
