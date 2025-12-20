# Implementation Plan: Avatar Upload and Profile Images

## 1. Overview
Goal: Extend the Profile experience with an “Edit Avatar” flow that lets users upload or capture a profile image, stores it safely in S3 under a clear prefix, and wires the resulting URL into the existing `profiles.avatar_url` field without affecting identification data or video encoding flows.

In scope:
- New Profile menu entry (“Edit Avatar”) and a dedicated avatar-edit page.
- Backend support for signed avatar uploads and for updating the Profile’s `avatar_url`.
- A simple, safe S3 layout for avatars (prefixes under the existing public output bucket) that works well with CloudFront and caching.

Out of scope (for this phase):
- Advanced image processing pipelines (face cropping, smart centers, background removal).
- Separate identity/verification image storage (ID docs, KYC artifacts).
- Per-space avatar variants or multiple avatars per user.

References:
- `agents/features/feature_01.md` — Profile vs Identification vs Credibility semantics.
- `agents/implementation/plan_02.md` — Profiles schema and backend services.
- `agents/implementation/plan_03.md` — `/profile` route, Profile form, and Profile menu context.
- `src/services/productionRunner.ts`, `docs/Jobs.md` — current S3 layout and profiles under `bacs-mc-public-stream`.

---

## 2. Storage and URL Strategy

For avatars we will:
- Reuse the existing **public output bucket** (e.g., `bacs-mc-public-stream`) that is already fronted by CloudFront.
- Introduce a stable top-level prefix for profile assets, such as:
  - `profiles/avatars/{userId}/{yyyy-mm}/{uuid}.jpg`
- Store the **S3 key** and derive a public URL via the existing CloudFront domain; we can continue to store only the URL in `profiles.avatar_url` for now, since we don’t need key-level management yet.
- Rely on object-key versioning (new file per change) instead of in-place mutation to simplify caching; changing the key when a user updates their avatar will naturally bust caches.

---

## 3. Step-by-Step Plan

1. Define avatar S3 layout and configuration  
   Status: Completed  
   Testing: Add a short “Avatar Storage” note to the relevant docs (e.g., `docs/Configuration.md` or `docs/Operations.md`) specifying the bucket, CloudFront domain, and prefix pattern (`profiles/avatars/...`). Optionally add env vars if needed (for example, `AVATAR_PREFIX`), but keep defaults aligned with the existing public bucket. Verify that the chosen prefix does not conflict with existing video output directories and that CloudFront can serve a test image from that path.

2. Add backend support for signed avatar uploads  
   Status: Completed  
   Testing: Implement an avatar-upload flow similar in spirit to the existing upload signing, but scoped to small images:  
   - New route (e.g., `POST /api/profile/avatar/sign`) that returns a signed S3 POST (bucket, key, fields) for the avatar prefix, constrained to image MIME types and a small max size.  
   - Optional helper route to finalize the avatar after upload (e.g., `POST /api/profile/avatar/complete`), which takes the agreed key and writes the corresponding CloudFront URL into `profiles.avatar_url`.  
   Confirm by manually uploading a small image via curl/Postman using the signed POST, then calling the finalize route and checking that the Profile’s `avatar_url` is updated correctly.

3. Implement Edit Avatar UI page and menu link  
   Status: Completed  
   Testing:  
   - Extend the Profile menu (`ProfileMenu`) to include an “Edit Avatar” link (e.g., `/profile/avatar`).  
   - Create a new SPA page (e.g., `frontend/src/app/ProfileAvatar.tsx`) with:  
     - A simple file picker for image upload (accepting `image/*`).  
     - Mobile-friendly camera capture via `<input type="file" accept="image/*" capture="user">` where supported.  
     - Preview of the selected image before upload.  
     - A clearly marked Save/Use Avatar button that performs the signed-upload flow and then calls the finalize API.  
   Verify that navigation from the Menu Selector → Profile → “Edit Avatar” loads the correct page, that selecting an image shows a preview, and that the avatar URL is updated in the Profile.

4. Optional lightweight image normalization (phase 1)  
   Status: Pending  
   Testing: For this phase, keep processing minimal and safe:  
   - Enforce basic constraints on the client and/or server (e.g., max file size, allowed formats JPG/PNG/WebP).  
   - Optionally add a server-side step that downscales very large images to a reasonable maximum dimension (e.g., 512x512) while preserving aspect ratio, using a simple image library.  
   - Ensure that any processing happens against the non-production DB and S3 per `agents/db_access.md`.  
   Confirm that avatars display crisply at intended sizes and that very large uploads are either rejected or normalized.

5. Profile integration and UX pass  
   Status: Pending  
   Testing:  
   - On the main Profile page (`/profile`), show the current avatar (if any), using the `profiles.avatar_url` field, with a clear link to “Edit Avatar”.  
   - Verify that updating the avatar via `/profile/avatar` immediately reflects on `/profile` and in any other avatar surfaces you choose to wire (e.g., nav, comments, space membership lists) in a later phase.  
   - Confirm that avatar URLs are public-only identity artifacts (no sensitive identification data, no EXIF leakage if processing strips metadata), and that they align with your boundary rules for Profile vs Identification.

---

## 4. Progress Tracking Notes

- Step 1 — Status: Completed (documented avatar storage layout under the public OUTPUT_BUCKET in `docs/Configuration.md` and `docs/Operations.md`, using a `profiles/avatars/{userId}/{yyyy-mm}/{uuid}.jpg` prefix and CloudFront-backed URLs).  
- Step 2 — Status: Completed (added `src/features/profiles/avatar.ts` to generate signed avatar upload posts to OUTPUT_BUCKET under `profiles/avatars/{userId}/{yyyy-mm}/{uuid}.ext` and implemented `/api/profile/avatar/sign` and `/api/profile/avatar/complete` routes in `src/routes/profiles.ts` to wire uploads into `profiles.avatar_url`).  
- Step 3 — Status: Completed (added `/profile/avatar` SPA route, `frontend/src/app/ProfileAvatar.tsx` for image selection/preview and signed upload using the new avatar APIs, and extended `ProfileMenu` with an “Edit Avatar” link so users can navigate there from the Profile menu).  
- Step 4 — Status: Pending.  
- Step 5 — Status: Pending.  
