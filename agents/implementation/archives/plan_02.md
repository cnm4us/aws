# Implementation Plan: Profiles, Identification Separation, and Credibility Surfaces (Phase 1)

## 1. Overview
Goal: Introduce a dedicated `profiles` layer for public identity, keep identification/verification on `users`, and add space-scoped credibility surfaces (backed by the existing numeric `credibility_score` and new per-space structures) in small, testable increments.

In scope:
- Adding database tables for `profiles`, `space_credibility`, and a minimal credibility log to support explanations.
- Backend services and APIs for reading/updating a user’s Profile (public identity) separately from account/identification data.
- A first pass at per-space credibility labels derived from existing numeric scores and suspensions, with read-only surfaces.
- Private, self-only views that explain current credibility status per space using logged events.

Out of scope (for this phase):
- Full identification/verification feature (separate identity table and flows).
- Final scoring formulas or complex moderation algorithms.
- Rich UI/UX design beyond minimal, functional Profile and explanation views.
- Production migration strategies; this plan assumes non-production DB environments, per `agents/db_access.md`.

References:
- `agents/features/feature_01.md` — conceptual boundaries for Profile, Identification, and Credibility.
- `agents/db_access.md` — DB safety, migrations, and mysql usage rules.
- `docs/RBAC_Implementation_Plan.md`, `docs/FeedsRBAC_DB.md` — RBAC and moderation context.

## 2. Step-by-Step Plan

1. Add schema for `profiles`, `space_credibility`, and credibility log  
   Status: Completed  
   Testing: Update `src/db.ts` (for example, `ensureSchema`) to create non-destructive, idempotent tables: `profiles` (user_id, display_name, avatar_url, bio, visibility flags, timestamps), `space_credibility` (user_id, space_id, label, effective_from/through), and `space_credibility_log` (user_id, space_id, label, reason, source, moderator_id, created_at). Apply the changes in a dev environment, confirm tables with `DESCRIBE`/`SHOW CREATE TABLE` via `mysql`, and ensure existing routes still run without errors.  
   Checkpoint: Wait for developer approval before proceeding.

2. Introduce backend profile model and service layer  
   Status: Completed  
   Testing: Create a `profiles` module (e.g., under `src/features/profiles/`) that encapsulates DB access for profiles (get by user_id, create/update, basic validation). Add unit-level tests or lightweight integration tests that exercise these functions directly against the dev DB. Confirm that these new services are not yet wired into public routes so existing behavior is unchanged.  
   Checkpoint: Wait for developer approval before proceeding.

3. Add Profile API endpoints and minimal UI surfaces  
   Status: Completed  
   Testing: Expose Profile read/update APIs and pages without touching Identification flows:  
   - API: endpoints for “get my profile”, “update my profile”, and “view another user’s profile” (public view).  
   - UI: minimal Profile page(s) showing display name, avatar, and bio, with very limited field-level visibility controls (e.g., optional bio visibility toggle).  
   Verify via HTTP/API tests and manual browser checks that:  
   - Profile edits are clearly marked as public and feel “ceremonial” (e.g., explicit confirmation or preview).  
   - No identification data (phone, KYC, verification_level, etc.) appears in Profile surfaces.  
   Checkpoint: Wait for developer approval before proceeding.

4. Model per-space credibility labels and logging (backend only)  
   Status: Pending  
   Testing: Implement a backend helper that computes a per-space credibility label from the existing `users.credibility_score`, active suspensions, and relevant RBAC context, without exposing raw numbers. Define a small, fixed label set (e.g., “Good Standing”, “Under Review”, “Posting Limited”, “Banned”) and store the current label per user/space in `space_credibility`, with changes appended to `space_credibility_log`. Add tests that simulate different combinations of score + suspensions and assert the label output and log entries. No UI changes yet.  
   Checkpoint: Wait for developer approval before proceeding.

5. Expose credibility labels in admin and Profile views (read-only)  
   Status: Pending  
   Testing:  
   - Admin surfaces: extend existing moderation/admin views (e.g., user moderation endpoints/pages) to show per-space credibility labels and recent log entries, but not raw scores.  
   - Public Profile: when viewing a Profile within a specific space context, show only the high-level credibility label (if any) for that space, with no metrics or strike counts.  
   Verify that:  
   - Labels never leak cross-space statuses.  
   - No numeric scores or internal moderation notes are rendered.  
   - Existing endpoints remain backward-compatible where needed.  
   Checkpoint: Wait for developer approval before proceeding.

6. Add private self-only credibility explanations per space  
   Status: Pending  
   Testing: Implement a self-only view (API + minimal UI) where a user can see:  
   - Their current credibility label per space.  
   - Human-readable reasons based on `space_credibility_log` and suspensions.  
   - Concrete guidance on remediation (e.g., “posting limited until DATE because REASON; to recover, do X/Y”).  
   Confirm via tests and manual checks that:  
   - Only the account owner can see their detailed explanations.  
   - The view is informational and actionable, not punitive or opaque.  
   - No sensitive identification data is exposed here.  
   Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed (idempotent schema for `profiles`, `space_credibility`, and `space_credibility_log` added to `src/db.ts` via `ensureSchema`; ready to apply in development DB).  
- Step 2 — Status: Completed (created `src/features/profiles/repo.ts` and `src/features/profiles/service.ts` to encapsulate profile persistence and validation, without wiring them into routes yet).  
- Step 3 — Status: Completed (extended `src/routes/profiles.ts` with user Profile APIs for “me” and public-by-userId views, preserving the existing `/api/profiles` MediaConvert profile listing; Profile endpoints rely on the new profiles service and do not expose any identification data).  
- Step 4 — Status: Pending.  
- Step 5 — Status: Pending.  
- Step 6 — Status: Pending.
