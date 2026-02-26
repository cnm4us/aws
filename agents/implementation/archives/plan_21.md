# Implementation Plan: Production Builder Page (`/produce`) + Optional Music/Logo (Stub)

## 1. Overview

Goal:
- Replace the “Create Production” one-click action on `/productions?upload=:uploadId` with a **Production Builder** page.
- New route: `/produce?upload=:uploadId`
  - Shows the selected upload (video).
  - Allows selecting optional **Music** and **Logo** assets (UI stubs for now).
  - Starts production when the user clicks **Produce**.

Primary UX intent:
- Separate “configure production inputs” from “run production job”.
- Keep the current productions list page focused on status/history.

Out of scope (for this plan):
- Implementing music uploads/library and logo uploads/library.
- Actually mixing audio or compositing logos in MediaConvert.
- Any membership/permissions changes beyond what’s needed for the new route.

---

## 2. Recommendation: Redirect After Produce

Best practice for this workflow:
- Redirect to **Production detail**: `/productions?id=:productionId`
  - Reason: production is typically asynchronous; the detail view is the natural “job status” destination.
  - Add/ensure a clear CTA from the detail view to **Publish** when ready (already exists today).

If you later want a faster “create → publish” flow:
- Optionally auto-link to `/publish?production=:productionId` when the production status becomes `completed`.

---

## 3. Step-by-Step Plan

1. Create a new SPA route/page: `/produce?upload=:uploadId`
   - Add `frontend/src/app/Produce.tsx`.
   - Load upload details from `GET /api/uploads/:id` (or reuse existing patterns).
   - UI layout:
     - Upload preview (poster or video if available).
     - Section: Music (disabled selector, “Coming soon”).
     - Section: Logo (disabled selector, “Coming soon”).
     - Primary button: **Produce**.

2. Wire Produce button to create a production
   - Call `POST /api/productions` with `{ uploadId, name?, config? }`.
   - For now, config includes optional placeholders:
     - `musicUploadId?: number | null`
     - `logoUploadId?: number | null`
   - Redirect to `/productions?id=:productionId` on success.

3. Update `/productions?upload=:uploadId` button behavior
   - Change “Create Production” to navigate to `/produce?upload=:uploadId`.
   - Keep any existing “quick create” path out of the main UI (optional: keep as a secondary link for admins/dev).

4. Extend API contract (optional fields, no-op initially)
   - Update `src/routes/productions.ts` `createProductionSchema` to accept `musicUploadId` and `logoUploadId` (optional).
   - Update `src/features/productions/service.ts` `create()` to persist these in `productions.config` (JSON) so they’re available when MediaConvert composition is implemented.
   - Do not change render behavior yet; just store.

5. Validation + basic safety
   - Validate that `musicUploadId` / `logoUploadId` are either omitted or positive ints.
   - If present, store them; don’t attempt to dereference/verify existence yet (until the assets feature exists).

6. Build + smoke test
   - `npm run web:build`
   - Manual:
     - Open `/productions?upload=...` → click Create Production → lands on `/produce?upload=...`.
     - Click Produce → redirects to `/productions?id=...` and shows job status.

---

## 4. Open Questions

1. Route naming: confirm `/produce?upload=:uploadId` vs `/productions/new?upload=:uploadId`.
2. Production naming on the builder page:
   - Should we include an optional “Production name” field here (like the current page), or keep name generation automatic for now?
3. Preview on builder page:
   - Poster-only, or reuse the same “tap-to-fullscreen video preview” pattern from `/publish` if `cdn_master` exists?

