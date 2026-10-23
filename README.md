aws-mediaconvert-service

This repo hosts a Node.js + TypeScript service that mints S3 presigned uploads, tracks them in MariaDB, and publishes AWS Elemental MediaConvert HLS jobs to an S3 bucket fronted by CloudFront.

Start Here
- docs/Overview.md — high-level system and feature tour
- docs/GettingStarted.md — install, run, first upload/publish
- docs/Configuration.md — env vars and defaults
- docs/Architecture.md — modules, flows, diagrams
- docs/API.md — endpoints and examples
- docs/s3_architecture.md — S3 prefix taxonomy + retention policy
- docs/codex/browser-debugging.md — browser debugging workflow for Codex via Chrome DevTools MCP

Build & Run (local development)
- `npm run build` — compile the Node.js/TypeScript service.
- `npm run web:build` — compile the service and rebuild the frontend SPA bundle under `public/app` (run this after UI changes).
- `npm run space:web:build` — build the Space Console bundle under `public/space-app` (run this after space console UI changes).
- `npm run serve` — start the development server (serves the API and SPA shell).

iPhone viewer (development and bundled internal builds)

- The separate `mobile/` package provides native Global/space viewing, existing-account sign-in, secure session restore/logout, vertical paging, and bounded preloading. The expanded viewer passed host/API/browser and installed iPhone development-build acceptance in Plan 168 (Complete), including denial/expiry recovery. VoiceOver is deferred and recorded accessibility/evidence limits remain. Sound settings remain device-local.
- Setup and device checks: [mobile/README.md](mobile/README.md).
- Accepted implementation and validation: [Plan 168](agents/implementation/plan_168.md). Original POC evidence: [Plan 167](agents/implementation/plan_167.md).
- Creator profiles and authorized personal-feed detours are accepted for the recorded iPhone development milestone in [Plan 169](agents/implementation/plan_169.md) (Complete, with coverage limits and an earlier unconfirmed native-freeze cause retained). Returns restore the original publication/time through a fresh authorized feed window. Personal access requires explicit authority; public flags/subscription alone are insufficient for both web and native.
- Publication story reading and saved CC controls are accepted for the bundled internal iPhone milestone in [Plan 170](agents/implementation/plan_170.md), with recorded coverage/readability limits. Viewer text reads enforce exact publication/context access and bounded ready-production VTT delivery. Caption clock updates work independently of development diagnostics.
- Run `npm ci` in `mobile/`, configure `mobile/.env` from its example, then run `npm run start:tunnel` for Expo Go or `npm run start:dev-client` for the installed development app on a remote development host.
- Backend native sessions require `NATIVE_SESSIONS_ENABLED=1`; configure `NATIVE_TRUST_LOOPBACK_PROXY=1` only for a trusted local TLS proxy. The additive native session and login-limit tables are created by schema setup; no browser session migration is needed. See [API contracts](docs/API.md).
- Mobile `eas.json` retains development/simulator profiles and adds a bundled internal Release `preview` using the same app identity/API. From `mobile/`, use `npm run export:preview` for the embedded iOS export and `npm run build:preview` for the signed build. The helper stamps included source and the cloud hook rejects stale uploads; local iOS build numbers are incremented deliberately. Internal reports/reset work without Metro; ordinary Release diagnostics default off. Build signing needs Apple Developer credentials; the original bundled baseline is accepted under [Plan171](agents/implementation/plan_171.md), and build6 adds the accepted UI refinement in [Plan172](agents/implementation/plan_172.md) with Metro/tunnel off. Installation, update and recovery instructions are in the mobile README. TestFlight/App Store submission is separate.
- Native UI: tap the current space name for Spaces and use the upper-right Menu for Account/sign-out, Settings, Refresh and internal Playback diagnostics (Share/reset replaces title long-press). Profile Menu utilities return to the profile. In `mobile/`, `npm run test:ui` runs actual component/navigation checks with controlled native ports; physical iPhone coverage and limits are documented separately.
- Plan173 adds native Creator/Global Launch navigation and additive authenticated viewer destination list/resolve reads. Source and destination publication access are checked independently; legacy Jump/native bearer scope is unchanged. Opt-in launch fixture/API/browser checks: `npm run viewer:fixtures:launch`, `npm run viewer:check:launch`, `npm run viewer:check:launch:web`. Run mutating checks sequentially; credentials stay ignored, Global publications and ordinary-account grants are untouched. Signed build10 functional and original numerical gates pass for the internal milestone; the recovered cold186 start remains a documented performance residual. Coverage/history/physical limits and delivery status are tracked in [Plan173](agents/implementation/plan_173.md).
- Backend checks: `npm run test:viewer`. Opt-in non-production fixtures: `npm run viewer:fixtures` (creates two ordinary users and labeled spaces, reusing public media only; credentials stay in ignored `.codex-local/plan168-fixtures.json`). Integration: `npm run viewer:check:sessions`, `npm run viewer:check`, and `npm run viewer:check:web`. Run the API scripts sequentially: they temporarily change fixture account/access state and restore it. Browser checks use the existing HTTPS development host and save sanitized evidence in ignored test-run folders.
- Creator fixture/check commands: `npm run viewer:fixtures:creators`, `npm run viewer:check:creators`, and `npm run viewer:check:creators:web`. They use separate disposable accounts and public-media metadata copies; credentials stay in ignored `.codex-local/plan169-fixtures.json`. Run mutation checks sequentially and preserve ordinary account access.
- Text fixture/check commands: `npm run viewer:fixtures:text`, `npm run viewer:check:text`, `npm run viewer:check:text:web`, then `cd mobile && npm run check:text`. Disposable credentials stay in ignored `.codex-local/plan170-fixtures.json`; no normal accounts, Global fixture publications or transcription jobs are added. Run mutating API suites sequentially; each restores its own fixture changes and revokes host-created sessions. The mobile check exercises the real HTTPS API with the native transport/parser.


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
- Admin moderation hub: /admin/moderation
- Admin moderation rules: /admin/moderation/rules
- Admin moderation categories: /admin/moderation/categories
- Admin moderation cultures: /admin/moderation/cultures
- Admin moderation signals: /admin/moderation/signals
- Admin pages editor: /admin/pages
- Admin groups/channels: /admin/groups and /admin/channels (create/edit includes Culture assignment + review settings)
- Public pages: / and /pages/:slug (path-like slugs, max 4 segments)
- Public rules: /rules/:slug and /rules/:slug/v:1

Legacy admin moderation aliases
- `/admin/rules`, `/admin/categories`, and `/admin/cultures` remain available as compatibility redirects to the canonical `/admin/moderation/*` pages.

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
- Publication Story (plain text, per space publication): `GET /api/publications/:id/story` and `PATCH /api/publications/:id/story` (owner/site_admin; CSRF required for PATCH).
- Upload thumbnail endpoint: `GET /api/uploads/:id/thumb` (first-frame thumbnail from the source upload; auth required).
- Upload metadata endpoint: `PATCH /api/uploads/:id` (updates `modified_filename` and `description`; owner/site_admin; CSRF required).
- Logo configs API: `GET /api/logo-configs`, `POST /api/logo-configs`, `PATCH /api/logo-configs/:id`, `POST /api/logo-configs/:id/duplicate`, `DELETE /api/logo-configs/:id` (archive; includes `description`).
- Lower third configs API: `GET /api/lower-third-configs`, `POST /api/lower-third-configs`, `PATCH|PUT /api/lower-third-configs/:id`, `DELETE /api/lower-third-configs/:id` (archive; includes `description`).
- Space feed supports optional `?pin=<production_ulid>` on `/groups/:slug` and `/channels/:slug` to show that production first (pins only on initial load).

One-off admin scripts
- `npm run admin:backfill-rule-drafts` — ensure `rule_drafts` exists for each rule (optional; drafts are lazily created on first edit).
- `npm run admin:own-uploads -- --email=user@example.com` — promote user to admin and claim unowned uploads.
- `npm run admin:backfill-spaces-ulid` — backfill `spaces.ulid` for older rows.
- `npm run moderation:signals:classification:backfill` — persist `polarity` and `signal_family` onto existing moderation signal rows.
- `npm run moderation:signals:classification:verify` — verify there are no moderation signals missing persisted classification.
- `ts-node scripts/backfill-upload-thumbs.ts --limit 25 --cursor 0` — enqueue ffmpeg thumbnail jobs for existing video uploads.

Moderation signals classification
- Moderation signals now use two classification fields:
  - `polarity` — operator-facing top-level grouping (`positive` or `disruptive`)
  - `signal_family` — normalized internal classification used for filtering and future mapping work
- A small set of current measurement-oriented signals uses temporary family assignments until the catalog is curated further:
  - `qualified_language` -> `positive / clarity`
  - `assertive_language` -> `disruptive / credibility`
  - `direct_identifiers` -> `disruptive / privacy_identity`
  - `indirect_identifiers` -> `disruptive / privacy_identity`
  - `factual_assertion` -> `positive / reasoning`
- Signal-ID singularization remains deferred unless a rename can be proven safe for existing rule, culture, and moderation-v2 references.

Notes
- Profiles live under jobs/profiles with a $extends mixin system; see docs/Jobs.md
- Request logs: logs/request/YYYY-MM-DD_hh:mm:ss.log (final CreateJob payloads)
