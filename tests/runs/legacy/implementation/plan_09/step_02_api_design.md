# Step 02 — API contract (Phase 2 SPA embed)

Date: 2025-12-23

This step is design-only. No new endpoints were implemented yet.

## Canonical endpoints (to be implemented in Step 03)

### `GET /api/pages/:slugPath`

- `:slugPath` supports `/` (path-like), max 4 segments.
- Normalization/validation must match HTML route logic:
  - lowercase
  - trim + strip leading/trailing `/`
  - each segment: `^[a-z][a-z0-9-]*$`
- `home` is allowed as a special slug (used by SPA for `/`).

Success (`200`):
```json
{
  "slug": "docs/getting-started",
  "title": "Getting Started",
  "html": "<h1>...</h1>...",
  "visibility": "public",
  "layout": "default",
  "updatedAt": "2025-12-23T00:00:00.000Z",
  "children": [
    { "slug": "docs/faq", "title": "FAQ", "url": "/pages/docs/faq" }
  ]
}
```

Errors:
- `400 { "error": "bad_slug" }`
- `404 { "error": "page_not_found" }`
- `401 { "error": "unauthorized" }`
- `403 { "error": "forbidden" }`

### `GET /api/rules/:slug`

- `:slug` is a single segment: `^[a-z][a-z0-9-]*$` (no `/` for rules in Phase 2).

Success (`200`):
```json
{
  "slug": "community-guidelines",
  "title": "Community Guidelines",
  "html": "<h1>...</h1>...",
  "visibility": "public",
  "currentVersion": {
    "version": 3,
    "url": "/rules/community-guidelines/v:3",
    "createdAt": "2025-12-23T00:00:00.000Z",
    "changeSummary": "..."
  },
  "versions": [
    { "version": 3, "url": "/rules/community-guidelines/v:3", "createdAt": "...", "changeSummary": "..." },
    { "version": 2, "url": "/rules/community-guidelines/v:2", "createdAt": "...", "changeSummary": "..." }
  ]
}
```

Errors:
- `400 { "error": "bad_slug" }`
- `404 { "error": "rule_not_found" }`
- `401 { "error": "unauthorized" }`
- `403 { "error": "forbidden" }`

## Notes

- Phase 2 does **not** add JSON endpoints for historical rule versions; deep links remain server-rendered at `/rules/:slug/v:version`.
- The SPA viewers will only render pre-rendered HTML (no client-side Markdown parsing).

