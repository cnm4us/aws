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
- `npm run serve` — start the development server (serves the API and SPA shell).

Useful Pages
- Uploader: / (upload.html)
- Publisher: /publish.html
- Player: /videos?id=123, /mobile?id=123

Notes
- Profiles live under jobs/profiles with a $extends mixin system; see docs/Jobs.md
- Request logs: logs/request/YYYY-MM-DD_hh:mm:ss.log (final CreateJob payloads)
