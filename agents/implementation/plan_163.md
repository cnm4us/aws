# Plan 163: Moderation Admin IA Consolidation

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Moderation administration is currently split across top-level admin surfaces such as `/admin/rules`, `/admin/categories`, and `/admin/cultures`, even though these screens now form one coherent moderation subsystem.
  - The moderation-v2 rollout added more interconnected moderation components, and future work will likely add still more operator surfaces. The current information architecture will become harder to navigate and harder to extend if moderation remains fragmented across the main admin menu.
- In scope:
  - Add a dedicated `/admin/moderation` hub page.
  - Move the primary moderation authoring surfaces to `/admin/moderation/rules`, `/admin/moderation/categories`, and `/admin/moderation/cultures`.
  - Replace the three main admin nav items with a single `Moderation` entry in the left admin menu.
  - Add a moderation-local secondary menu/shared navigation across moderation pages.
  - Keep existing routes alive as redirects during migration.
  - Update page links, breadcrumbs, CTA hrefs, and smoke/docs references to the new canonical route family.
- Out of scope:
  - Changing moderation data models or DB schema.
  - Redesigning the full moderation UX beyond route/nav consolidation.
  - Moving unrelated report/review pages unless explicitly folded into this plan later.
  - Removing legacy redirects immediately after rollout.
- Constraints:
  - Existing bookmarks and operator habits must keep working during migration.
  - Permissions must remain unchanged; this is an IA move, not an auth rewrite.
  - The app must remain runnable after each phase.
  - Canonical destination should be obvious and consistent before legacy redirects are introduced broadly.

## Locked Decisions
- `Cultures` is a moderation concept, not a standalone product-domain concept; canonical naming is effectively “moderation culture profiles.”
- Canonical authoring routes move under `/admin/moderation/*`.
- Legacy top-level routes (`/admin/rules`, `/admin/categories`, `/admin/cultures`) remain as redirect aliases during migration.
- Main admin left-nav becomes a single `Moderation` entry rather than retaining three separate entries.
- Moderation pages get a local/shared moderation nav so operators can move between subsystem tools without returning to the global admin index.
- This phase is route/nav consolidation only; no moderation contract or persistence changes are bundled into it.

## Phase Status
- A: Complete
- B: Pending
- C: Pending
- D: Pending
- E: Pending

## Phase A — Route Contract and Navigation Skeleton
- Goal:
  - Define the canonical moderation route family and establish reusable navigation helpers before migrating individual pages.
- Steps:
  - [ ] Add moderation route constants/helpers for canonical paths and legacy redirects.
  - [ ] Add a moderation-local nav renderer/shared helper in `src/routes/pages.ts`.
  - [ ] Define moderation admin active keys (`moderation`, `moderation_rules`, `moderation_categories`, `moderation_cultures`) so page chrome remains consistent.
  - [ ] Audit all hardcoded links/back-links for rules/categories/cultures and list required replacements.
- Test gate:
  - `npm run build`
  - Expected result: shared route/nav helpers compile without changing behavior yet.
- Acceptance:
  - The route contract is explicit, and page code has a reusable way to render moderation-local navigation.

## Phase B — Moderation Hub and Global Admin Nav Cutover
- Goal:
  - Introduce `/admin/moderation` as the new subsystem entry and replace the main admin left-nav items.
- Steps:
  - [ ] Add `/admin/moderation` hub page with links/cards for `Rules`, `Categories`, and `Cultures`.
  - [ ] Update the main admin left menu to replace the three existing entries with a single `Moderation` item.
  - [ ] Add clear descriptions on the hub page so future moderation tools have an obvious landing surface.
  - [ ] Keep the old pages reachable directly during this phase.
- Test gate:
  - `npm run build`
  - Manual verify `/admin`, `/admin/moderation`, and left-nav highlighting.
- Acceptance:
  - The admin shell now presents moderation as one subsystem with its own landing page.

## Phase C — Categories and Cultures Route Migration
- Goal:
  - Move category/culture CRUD surfaces to canonical moderation-prefixed routes while preserving legacy access via redirects.
- Steps:
  - [ ] Add canonical routes for:
    - `/admin/moderation/categories`
    - `/admin/moderation/categories/new`
    - `/admin/moderation/categories/:id`
    - `/admin/moderation/cultures`
    - `/admin/moderation/cultures/new`
    - `/admin/moderation/cultures/:id`
  - [ ] Update all page actions, toolbar back-links, related-object links, and delete redirect destinations to use canonical moderation routes.
  - [ ] Add legacy redirects from `/admin/categories*` and `/admin/cultures*` to the new canonical pages.
  - [ ] Ensure moderation-local nav is present on all migrated pages.
- Test gate:
  - `npm run build`
  - Manual verify create/edit/delete flows for categories and cultures using both canonical routes and legacy redirects.
- Acceptance:
  - Categories and cultures live canonically under `/admin/moderation/*`, and the old URLs still work through redirects.

## Phase D — Rules Route Migration
- Goal:
  - Move the more complex rules authoring/versioning surfaces under moderation-prefixed routes.
- Steps:
  - [ ] Add canonical routes for:
    - `/admin/moderation/rules`
    - `/admin/moderation/rules/new`
    - `/admin/moderation/rules/:id`
    - `/admin/moderation/rules/:id/edit`
    - `/admin/moderation/rules/:id/versions/new`
  - [ ] Update rules list/detail/edit/version pages, pagination links, publish redirects, and delete flows to the canonical moderation route family.
  - [ ] Add legacy redirects from `/admin/rules*` to the moderation-prefixed equivalents.
  - [ ] Verify styling/active-nav behavior still works for the rules surfaces, including any page-specific CSS selectors keyed off old href prefixes.
- Test gate:
  - `npm run build`
  - Manual verify rule list/detail/edit/new-version/delete flows from both canonical and legacy entry points.
- Acceptance:
  - Rules authoring/versioning routes are fully migrated under `/admin/moderation/*` with legacy compatibility intact.

## Phase E — Documentation, Smoke Updates, and Legacy Cleanup Policy
- Goal:
  - Finish the migration by aligning docs/tests and documenting the redirect policy.
- Steps:
  - [ ] Update docs, implementation notes, and any test/runbooks that refer to `/admin/rules`, `/admin/categories`, or `/admin/cultures` as canonical paths.
  - [ ] Add a focused admin route smoke or checklist covering canonical moderation paths plus legacy redirects.
  - [ ] Update breadcrumbs, operator-facing help text, and any admin hub cards to refer to the moderation subsystem consistently.
  - [ ] Record a follow-up policy for when legacy redirects can be removed, but do not remove them in this plan.
- Test gate:
  - `npm run build`
  - `npm run check:agents:docs`
  - Manual verify route/docs references are coherent.
- Acceptance:
  - Moderation admin IA is coherent in code, docs, and operator workflow, with a deliberate redirect deprecation path.

## Change Log
- 2026-04-10 — Plan drafted for moderation admin IA consolidation: `/admin/moderation` hub, canonical moderation-prefixed authoring routes, global nav collapse to one `Moderation` entry, and moderation-local secondary navigation.
- 2026-04-10 — Phase A completed: added moderation admin route helpers/constants, moderation-specific admin active keys, and a reusable moderation subnav renderer in `src/routes/pages.ts`; audited current hardcoded route touchpoints in admin nav, admin hub tiles, rules pages, category pages, culture pages, related-object links, delete redirects, and the rules page CSS selector keyed to `/admin/rules/`.

## Validation
- Environment:
  - development
- Commands run:
  - `npm run build`
- Evidence files:
  - `agents/README.md`
  - `agents/implementation_planning.md`
  - `agents/implementation/PLAN_TEMPLATE.md`
  - `agents/implementation/INDEX.md`
  - `agents/implementation/plan_163.md`
  - `src/routes/pages.ts`
- Known gaps:
  - Route-by-route migration complexity for rules is estimated from current page code, but execution may uncover additional hardcoded links or styling assumptions.

## Open Risks / Deferred
- Risk:
  - Rules pages have the broadest route surface and may contain subtle old-path assumptions in redirects, pagination, or CSS selectors.
- Risk:
  - If future moderation tooling expands quickly, the moderation hub may need a second-level IA revision sooner than expected.
- Deferred item:
  - Folding additional moderation tools such as policy profiles, evaluation debug, review queues, or report aliases into `/admin/moderation/*`.
- Deferred item:
  - Removal of legacy `/admin/rules`, `/admin/categories`, and `/admin/cultures` redirect aliases.

## Resume Here
- Next action:
  - Start Phase B by adding `/admin/moderation` hub UI and collapsing the main admin left nav to a single `Moderation` entry.
- Blocking question (if any):
  - none
