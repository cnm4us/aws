Handoff 20

Priority Backlog (Refactor Objectives)
- Objective:
  - Organize code to facilitate adding new features and extending existing ones quickly.
  - Organize code so it’s optimized for agent work: consistent patterns, thin routes, typed services, standard validation and errors.
- Instructions:
  - Maintain this Priority Backlog at the top of each Handoff_N.md.
  - Copy this section forward to Handoff_{N+1}.md at the start of a new thread and update statuses as items complete or are added.
  - Use P1 for highest-impact foundation items; P2 for high-value follow-ups; P3 for structural polish.

- P1 (foundation, highest impact)
  - [ ] Unify HLS playback across browsers; avoid Chrome native .m3u8
  - [ ] Componentize feed video player (HLSVideo)

- P2 (high‑value follow‑ups)
  - [ ] Warm-up preloading for next slide
  - [ ] Centralize Safari detection utility
  - [ ] Minimal refactor of Feed.tsx to use components

- P3 (structural polish)
  - [ ] Future: pool hls.js instances to reduce GC churn
  - [ ] Future: predictive preloading hooks

Summary
- [init] New thread. Reconstructed context from `agents/handoff/Handoff_19.md`.
- [feat] Implemented plan_11: split rule “Guidance” into separate Moderators vs AI Agents fields across DB, admin editing, API, SPA rule viewing, and historical rule pages.
- [feat] Implemented plan_12 (partial): admin-only Cultures CRUD (create/list/detail/edit) + category assignment + safe delete (blocked if any category associations exist).

Decisions (carried + new)
- Carried:
  - Keep using hls.js for non‑Safari browsers; rely on native HLS only on Safari/iOS.
  - Never assign `.m3u8` to `<video src>` on Chrome/Android; store manifest in `data-video-src` and let hls.js attach.
  - Asset orientation drives stream selection; device rotation does not swap stream.
  - Use object-fit contain for robust sizing; allow portrait assets to use cover in portrait for edge-to-edge.
  - Publishing semantics (Personal vs Global, Phase 1) from Handoff 18 and `agents/implementation/plan_06.md` remain in force.
  - Introduce globally unique, user-editable `users.slug` values with a reserved list and strict validation.
  - Add public profile routes/pages at `/users/:slug`, with numeric-id fallback preserved for backwards compatibility.
  - Rules support an editable head “draft” in `rule_drafts`:
    - Save updates `rule_drafts` plus `rules.title`/`rules.category_id` immediately, without creating a new `rule_versions` row.
    - Publish Version snapshots the current draft to a new immutable `rule_versions` row and updates `rules.current_version_id`.
  - Admin `/admin/rules` supports:
    - “Draft pending” indicator (draft updated after current published version).
    - Sortable column headers via `?sort=<key>&dir=asc|desc`.
    - Category filter jump menu via `?categoryId=<id>` (All option; no submit).
- New:
  - Rule guidance is split into:
    - `rule_versions.guidance_moderators_markdown/html`
    - `rule_versions.guidance_agents_markdown/html`
    - (and the corresponding `rule_drafts` columns).
  - Access control: both guidance fields are gated identically via `canViewGuidance` (same as legacy guidance behavior).
  - `/api/rules/:slug` now returns `guidanceModeratorsHtml` and `guidanceAgentsHtml` (instead of `guidanceHtml`).
  - Cultures (admin-only, Phase 1):
    - `cultures` defines a named moderation culture (name unique, optional description).
    - `culture_categories` assigns 0..N `rule_categories` to a culture.
    - Delete culture is only allowed when it has 0 assigned categories (future: also require no space associations).

Changes Since Last
- Affects: `src/db.ts`; `src/routes/pages.ts`; `frontend/src/app/RuleView.tsx`; `scripts/backfill-rule-drafts.ts`; `agents/implementation/plan_11.md`; `agents/implementation/tests/plan_11/*`
- Routes:
  - GET `/admin/rules/:id/edit` (draft editor now shows 2 guidance fields)
  - POST `/admin/rules/:id/edit` (save/publish persists both guidance fields)
  - GET `/admin/rules/:id/versions/new` (new version form now shows 2 guidance fields)
  - POST `/admin/rules/:id/versions/new` (new version persists both guidance fields)
  - GET `/api/rules/:slug` (returns `guidanceModeratorsHtml` + `guidanceAgentsHtml`)
  - GET `/rules/:slug/v:n` (renders 2 guidance sections when authorized)
- DB:
  - Added: `rule_versions.guidance_moderators_markdown/html`, `rule_versions.guidance_agents_markdown/html`
  - Added: `rule_drafts.guidance_moderators_markdown/html`, `rule_drafts.guidance_agents_markdown/html`
  - Backfill: legacy `guidance_*` copied → `guidance_moderators_*` when new columns are NULL
- Flags: none

Changes Since Last (cultures)
- Affects: `src/db.ts`; `src/routes/pages.ts`; `agents/implementation/plan_12.md`; `agents/implementation/tests/plan_12/*`; `README.md`
- Routes:
  - GET `/admin/cultures`
  - GET `/admin/cultures/new`
  - POST `/admin/cultures`
  - GET `/admin/cultures/:id`
  - POST `/admin/cultures/:id` (edit + assign categories)
  - POST `/admin/cultures/:id/delete` (blocked if any category associations)
- DB:
  - Added: `cultures`
  - Added: `culture_categories`
- Flags: none

Open Questions / Deferred
- plan_10: draft refresh/clear-on-publish is not implemented (draft remains; “Draft pending” uses timestamps vs current published version).
- Moderation workflows and reporting UI remain deferred (flagging, sanctions, per-space rule sets).
- plan_11: deferred explicit drop of legacy `guidance_markdown/html` columns (requires explicit approval; see plan_11 Step 7).

Thread Plan (subset of Backlog)
- [ ] Optional: execute plan_11 Step 7 (drop legacy columns) after verification and explicit approval.

Work Log (reverse‑chronological)
- 2025-12-27 — plan_12 Steps 1–4 completed (schema + admin list/create + detail/assignment + delete guard); tests logged under `agents/implementation/tests/plan_12/`.
- 2025-12-26 16:05Z — plan_11 Steps 1–6 completed (schema + admin UI + save/publish + new version form + viewing surfaces + backfill script); tests logged under `agents/implementation/tests/plan_11/`.
- 2025-12-26 14:55Z — Read `agents/README.md`; read `agents/handoff/Handoff_19.md`; created `agents/handoff/Handoff_20.md`.
