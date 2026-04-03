# Plan 156: Pages/Docs Hierarchy Refactor (Section + Document Model)

Status: Draft

## Context
- Current docs navigation relies heavily on slug path patterns (for example `docs/...`) to imply hierarchy.
- You want hierarchy to be explicit and independent from slug prefixes.
- Existing docs content is placeholder/stub and can be discarded.

## Goal
Replace slug-derived docs hierarchy with an explicit parent/child structure supporting:
- top-level `/pages` listing of Sections and Documents,
- nested Sections containing both Sections and Documents,
- document URLs that remain human-readable via slugs.

## Non-Goals
- Backward compatibility for current stub docs paths/content.
- Migration/preservation of existing docs bodies.
- Rich permissions model changes beyond current admin edit access.

## Proposed Data Model
- Rework `pages` into a node-based model:
  - `id` (pk)
  - `type` enum: `section | document`
  - `title` (required)
  - `slug` (required, unique within the same parent)
  - `parent_id` nullable fk -> `pages.id`
  - `sort_order` int default 0
  - `visibility` (reuse existing model if needed)
  - `markdown`, `html` (document content; empty for sections)
  - `created_by`, `updated_by`, timestamps
- Constraints/rules at service layer:
  - `document` cannot have children.
  - `section` can have children of both types.
  - root items have `parent_id IS NULL`.
  - sibling slug uniqueness:
    - no duplicate `slug` under the same `parent_id`
    - applies to root siblings as well

## URL Strategy
- Public:
  - `/pages` = root listing.
  - `/pages/:path` = section or document path (computed from parent chain + slug), for example:
    - `/pages/moderation/child-a`
    - `/pages/moderation/child-b`
- Admin:
  - `/admin/pages` = root manager (cards/tree).
  - `/admin/pages/:id` = edit node.
  - `/admin/pages/new` = create node with type selector + optional parent.

## Phases

## Phase A — Schema Reset + Core Service Model
- Replace current page hierarchy assumptions with explicit node model.
- Add/normalize columns: `type`, `parent_id`, `sort_order`.
- Add indexes:
  - `idx_pages_parent_sort (parent_id, sort_order, id)`
  - parent-scoped slug uniqueness (service-enforced, with DB index where feasible).
- Remove old stub docs rows and seed minimal clean root structure.
- Acceptance:
  - DB supports section/document nodes with explicit parent references.
  - Fresh seed works with no `docs/` slug dependence.

## Phase B — Public Resolver (Hierarchy by Parent/Child)
- Build resolver to fetch children by `parent_id`.
- `/pages` returns root-level listing (sections + documents).
- `/pages/:path` resolves node by traversing slug segments against parent chain.
- For section pages:
  - render listing of child sections/documents.
- For document pages:
  - render document content.
- Acceptance:
  - Public docs navigation works entirely from parent/child relationships.

## Phase C — Admin List/Create/Edit UX
- `/admin/pages`:
  - show root nodes as cards/tree rows by title.
  - show type (`Section`/`Document`) and updated time.
  - actions: open/edit, create child section, create child document.
- `/admin/pages/new`:
  - choose `type`.
  - choose parent (optional; root when empty).
  - document fields shown only when `type=document`.
- `/admin/pages/:id`:
  - edit title/slug/parent/sort/content.
  - `type` is fixed at creation time (no section<->document mutation).
- Acceptance:
  - Admin can manage hierarchy without encoding path in slug.

## Phase D — Ordering + Validation Rules
- Enforce service validations:
  - no cycles in parent chain.
  - no child under a document.
  - no type mutation after creation.
  - sibling slug uniqueness under same parent.
- Add sibling ordering support via `sort_order`.
- Optional quick controls:
  - move up/down within same parent.
- Acceptance:
  - Stable, predictable ordering and valid hierarchy invariants.

## Phase E — Cleanup + Routing + Docs
- Remove old TOC/docs-prefix-specific logic.
- Update help text in admin forms to describe section/document model.
- Update docs:
  - `docs/Architecture.md` (page hierarchy model),
  - `docs/API.md` (public page resolver behavior),
  - `docs/Changelog.md`.
- Acceptance:
  - No docs path logic depends on hardcoded `docs/` prefix.

## Open Decisions
1. **Resolved**: Slug uniqueness is per-parent (hierarchical paths use section slugs).
2. **Resolved**: Node type is immutable after create (no section/document mutation).
3. **Resolved**: Visibility is supported on both sections and documents.

## Risks
1. Resolver ambiguity or collisions from bad parent-scoped slug validation.
  - Mitigation: strict service checks + DB constraints/indexes where feasible.
2. Invalid trees from admin edits.
  - Mitigation: strict service validations and cycle checks.
3. UX complexity in large trees.
  - Mitigation: start with root + one-level expansion; add search/filter later.

## Smoke Matrix
1. Create root section (`Guides`) and root document (`Welcome`) in admin.
2. Create nested section under `Guides` (`Moderation`).
3. Create document under nested section (`Flagging`).
4. Visit `/pages` and verify root entries show correctly.
5. Navigate into section and verify child listing.
6. Open document and verify content render.
7. Reparent document from one section to another; verify route and listing update.
8. Attempt invalid parent assignment (document as parent); verify validation error.

## Definition of Done
- Hierarchy is parent/child driven, not slug-prefix driven.
- `/pages` and nested docs navigation work with section/document nodes.
- Admin supports creating/managing both node types with parent assignment.
- Stub legacy docs removed and replaced by clean structure.
