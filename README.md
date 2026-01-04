aws-mediaconvert-service

This repo hosts a Node.js + TypeScript service that mints S3 presigned uploads, tracks them in MariaDB, and publishes AWS Elemental MediaConvert HLS jobs to an S3 bucket fronted by CloudFront.

Start Here
- docs/Overview.md — high-level system and feature tour
- docs/GettingStarted.md — install, run, first upload/publish
- docs/Configuration.md — env vars and defaults
- docs/Architecture.md — modules, flows, diagrams
- docs/API.md — endpoints and examples

Build & Run (local development)
- `npm run build` — compile the Node.js/TypeScript service.
- `npm run web:build` — compile the service and rebuild the frontend SPA bundle under `public/app` (run this after UI changes).
- `npm run space:web:build` — build the Space Console bundle under `public/space-app` (run this after space console UI changes).
- `npm run serve` — start the development server (serves the API and SPA shell).

Useful Pages
- Uploader: / (upload.html)
- Publisher: /publish.html
- Player: /videos?id=123, /mobile?id=123
- Logo configs (branding presets): /logo-configs

Admin + CMS surfaces (server-rendered)
- Admin landing: /admin
- Admin review console: /admin/review (Global Feed, Personal Spaces, Groups, Channels)
- Admin users: /admin/users
- Admin settings: /admin/settings (stub; coming soon)
- Admin dev: /admin/dev
- Admin pages editor: /admin/pages
- Admin rules editor: /admin/rules
- Admin cultures editor: /admin/cultures
- Admin categories: /admin/categories
- Admin groups/channels: /admin/groups and /admin/channels (create/edit includes Culture assignment + review settings)
- Public pages: / and /pages/:slug (path-like slugs, max 4 segments)
- Public rules: /rules/:slug and /rules/:slug/v:1

Space console (separate bundle, space_admin / space_moderator)
- Space admin landing: /space/admin
- Space moderation landing: /space/moderation
- Review overviews: /space/review/groups and /space/review/channels
- Per-space admin UI: /spaces/:id/admin
- Per-space review queue: /spaces/:id/review

Moderation reporting (SPA)
- Feed flag/report modal is driven by Space → Cultures → Categories → Rules.
- Reporting is per Space Publication (space_publications.id) and is visible as “Sent” for the reporting user across devices.

API testing (authenticated)
- Use `scripts/auth_curl.sh` for authenticated requests (session + CSRF).
- Store local creds in `.codex-local/auth_profiles.env` (gitignored; see `.codex-local/auth_profiles.env.example`).
- Typical flow:
  - `BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login`
  - `BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /api/me`
- Useful endpoint: `GET /api/publications/:id/jump-spaces` (lists Group/Channel spaces where the same `production_id` is published; used by the Global Feed “Jump” modal).
- Upload thumbnail endpoint: `GET /api/uploads/:id/thumb` (first-frame thumbnail from the source upload; auth required).
- Logo configs API: `GET /api/logo-configs`, `POST /api/logo-configs`, `PATCH /api/logo-configs/:id`, `POST /api/logo-configs/:id/duplicate`, `DELETE /api/logo-configs/:id` (archive).
- Space feed supports optional `?pin=<production_ulid>` on `/groups/:slug` and `/channels/:slug` to show that production first (pins only on initial load).

One-off admin scripts
- `npm run admin:backfill-rule-drafts` — ensure `rule_drafts` exists for each rule (optional; drafts are lazily created on first edit).
- `npm run admin:own-uploads -- --email=user@example.com` — promote user to admin and claim unowned uploads.
- `npm run admin:backfill-spaces-ulid` — backfill `spaces.ulid` for older rows.
- `ts-node scripts/backfill-upload-thumbs.ts --limit 25 --cursor 0` — enqueue ffmpeg thumbnail jobs for existing video uploads.

Notes
- Profiles live under jobs/profiles with a $extends mixin system; see docs/Jobs.md
- Request logs: logs/request/YYYY-MM-DD_hh:mm:ss.log (final CreateJob payloads)
