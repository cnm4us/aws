# Implementation Plan: End-User Reporting (Flag Modal by Space Cultures)

## 1. Overview

Goal: Add an authenticated “Flag / Report” UX on video slides that shows rule options derived from the slide’s Space configuration:
- Slide → `space_publications.id` (“publicationId”) and `publication.space_id`
- Space → `space_cultures` (0..N)
- Cultures → `culture_categories` (0..N categories)
- Categories → `rules.category_id` (0..N rules)

Reporting is **per space publication** (because the same production can exist in multiple spaces with different cultures). A report stores both:
- `space_publication_id` (primary anchor for “this post in this space”)
- `production_id` (for convenience/analytics; sourced from the publication record)
- a single selected `rule_id` (single-select UX)

Decisions confirmed:
- Reporting requires authentication.
- If a space has no cultures, the reporting UI shows zero rules (no implicit “Global”).

In scope:
- DB schema to store reports for `(space_publication_id, production_id, reporter_user_id, selected rules...)`.
- JSON APIs for:
  - listing reporting options for a publication (categories + rules)
  - fetching rule detail on demand (reuse existing `/api/rules/:slug`)
  - submitting a report
  - marking “already reported by me”
- SPA changes:
  - add a flag icon to each slide
  - open a modal that is lazy-loaded and dismissible without losing playback context
  - visually mark “already reported by me” (only for the current user)

Out of scope (for this plan):
- Moderator/admin review workflow for reports (queues, triage, outcomes).
- Notifications, enforcement actions, automated moderation decisions.

Primary files (expected):
- DB: `src/db.ts`
- Feed APIs: `src/routes/spaces.ts`, `src/features/feeds/repo.ts`, `src/features/feeds/service.ts`
- Reporting APIs (new router): likely `src/routes/reports.ts` (mounted in server) or add to an existing API router if one exists.
- SPA: `frontend/src/app/Feed.tsx` (flag icon integration) + new lazy modal component under `frontend/src/…`

---

## 2. Step-by-Step Plan

1. Confirm identifiers + UX constraints  
   Status: Completed (2025-12-27)  
   Confirm:
   - Slide has `publicationId` (`space_publications.id`) and `spaceId` available in SPA (it already does via feed payload).
   - Rule detail view for the modal will reuse `GET /api/rules/:slug` (already returns short/long + examples).
   - Reporting selection is single rule (radio/select-one), not multi-select.

2. Add schema for reporting (publication-scoped)  
   Status: Completed (2025-12-27)  
   In `src/db.ts`, add (idempotent, additive):
   - `space_publication_reports`:
      - `id` (PK)
      - `space_publication_id` (FK → `space_publications.id`)
     - `space_id` (FK → `spaces.id`) *(denormalized for querying; sourced from publication)*
     - `production_id` (FK → `productions.id`) *(sourced from publication’s resolved production)*
     - `reporter_user_id` (FK → `users.id`)
     - `rule_id` (FK → `rules.id`) *(single selected rule)*
     - `rule_version_id` (FK → `rule_versions.id`) *(store “current version at time of report”)*
     - `created_at`
     - (optional) unique constraint: `(space_publication_id, reporter_user_id)` to prevent duplicate reports by the same user
   Notes:
   - Single-select keeps schema minimal; if we later want multi-select, add a join table in a follow-up plan.
   - Use best-effort FKs in `try/catch` like other newer tables.

   Testing:
   - Record schema check output in `agents/implementation/tests/plan_14/step_02_schema.md`.

3. Add “reporting options” API for a publication (categories + rules)  
   Status: Completed (2025-12-27)  
   Add an authenticated endpoint (exact route TBD; recommendation):
   - `GET /api/publications/:id/reporting/options`
     - Auth: `requireAuth`
     - Authorization: user must be able to view the publication in that space (reuse existing space feed visibility checks).
     - Response:
       - `spacePublicationId`, `spaceId`
       - `categories: Array<{ id, name, rules: Array<{ id, slug, title, shortDescription? }> }>`
       - `reportedByMe: boolean`
   Query logic:
   - Load publication to get `space_id` and `production_id` (do not trust client-supplied values).
   - List cultures for space: `space_cultures`.
   - List categories for those cultures: `culture_categories` → `rule_categories`.
   - List rules for those categories, filtered by end-user visibility:
     - since reporting requires auth: allow `rules.visibility IN ('public','authenticated')` only.
   - Include `short_description` from the rule’s current version (`rule_versions` via `rules.current_version_id`).
   - If space has 0 cultures → return `categories: []`.

   Testing:
   - Record curl output in `agents/implementation/tests/plan_14/step_03_options_api.md`.

4. Add “submit report” API (checkboxes → DB rows)  
   Status: Completed (2025-12-27)  
   Add an authenticated endpoint (recommendation):
   - `POST /api/publications/:id/report`
     - Body: `{ ruleId: number }` (required)
     - Server resolves `(space_id, production_id)` from publication.
     - Validate ruleId is valid for that publication’s space:
       - Each rule’s `category_id` must be in the set of categories attached via the space’s cultures.
       - Each rule’s visibility must be `public|authenticated`.
     - Insert report + selected rules in a transaction.
     - Duplicate behavior:
       - If enforcing `(space_publication_id, reporter_user_id)` uniqueness: return `409 already_reported` and keep UI marked.
       - Alternative: upsert/replace prior selections (explicitly decide; plan assumes 409 for now).
     - Response: `{ ok: true, reportId }` (and optionally `reportedByMe: true`).

   Testing:
   - Record curl output in `agents/implementation/tests/plan_14/step_04_submit_api.md`.

5. Feed enrichment for “already reported” marker (server-provided)  
   Status: Completed (2025-12-27)  
   Update feed queries (both global and per-space):
   - Add `publication.reported_by_me` (boolean) computed via `EXISTS` join against `space_publication_reports` for the current user + publication.
   Files likely:
   - `src/features/feeds/repo.ts` (add columns / joins)
   - `src/features/feeds/service.ts` (include field in `publication` object)
   This makes the flag icon accurate on initial render and after refresh.

   Testing:
   - Record sample feed JSON with the new field in `agents/implementation/tests/plan_14/step_05_feed_marker.md`.

6. SPA: add flag icon + lazy modal reporting UI  
   Status: Completed (2025-12-27)  
   UI entry:
   - In `frontend/src/app/Feed.tsx`, add a flag icon button near like/comment controls:
     - Disabled/hidden if `publicationId` missing.
     - Visual “already reported” state based on `publication.reportedByMe` (and/or local optimistic state after submit).
   Modal (lazy loaded):
   - Create `frontend/src/.../ReportModal.tsx` and load via `React.lazy` on click.
   - Modal behavior:
     - On open: fetch `/api/publications/:id/reporting/options`.
     - Show categories as headers and rules underneath.
     - Expand rule → show short description inline.
     - “More” → load `/api/rules/:slug` on-demand and show tabs/sections:
       - Long Description, Allowed Examples, Disallowed Examples
     - Single-select for rule choice (radio / select-one) + Submit via `POST /api/publications/:id/report`.
     - On submit success:
       - close modal (or show confirmation then close)
       - update local state so the flag icon marks “reported”
   UX constraints:
   - Closing the modal returns to the slide with playback state preserved as much as possible (no route change).

   Build:
   - Run `npm run web:build`.

   Testing:
   - Record notes/screenshots description in `agents/implementation/tests/plan_14/step_06_spa_ui.md` (no secrets).

7. (Optional) Minimal admin/debug visibility for reports (follow-up plan)  
   Status: Pending  
   Not required for end-user flow, but useful soon:
   - a site-admin endpoint/page to list recent reports and selected rules.

---

## 3. Risks / Edge Cases

- Spaces with no cultures: modal should clearly indicate “No reporting options configured for this space.”
- Rule changes over time: store `rule_version_id` at report time so moderators can interpret the user’s selection later.
- Feed performance: `reported_by_me` joins must be indexed (`(space_publication_id, reporter_user_id)`).

## 4. Open Questions (max 3)

1. Should a user be allowed to submit more than one report per `(space_publication_id)` (e.g., “edit report” vs “409 already_reported”)?
2. When a space has zero rules, should the flag button be hidden, disabled with a tooltip, or still open the modal with an explanation?
