# Plan 84 — MediaJobs Observability Upgrade (Phased)

## Goals
- Make MediaJobs logs a comprehensive, fast-to-debug view without large architecture changes.
- Enable per-job traceability (correlation ID), basic cost insights, and storage mapping.
- Preserve current job flow and add richer metadata in Attempt Manifests.

---

## Phase 1 — Richer Attempt Manifests (Debug first)

### 1) Add timing + summaries to Attempt Manifest
- `startedAt`, `finishedAt`, `durationMs`
- `inputSummary` (sanitized minimal shape: job type, key ids, durations)
- `ffmpegCommands` (already for export + thumb)
- `s3Ops`: array of `{ op, bucket, key, bytes?, durationMs?, status }`
- `errors`: array of `{ code?, message? }`

### 2) Instrumentation points
- `runFfmpeg`: record duration + status per command
- `downloadS3ObjectToFile`, `uploadFileToS3`: record op, bucket, key, bytes, duration
- attach all to `scratchManifestJson`

### 3) Keep manifests small
- truncate long stderr/stdout in manifest (logs stay in S3)
- cap `ffmpegCommands` array (e.g., 20)

**Acceptance:**
- Attempt Manifest shows duration, ffmpeg commands, S3 ops, errors.

---

## Phase 2 — UI Ergonomics

### 4) Admin MediaJobs list
- Filters: job type, status, date range
- Show `durationMs` + `attempts` at a glance

### 5) Attempt detail view
- Collapsible “Attempt Manifest” with tabs:
  - Summary
  - ffmpegCommands
  - S3 Ops
  - Errors
- Clear timeline: start → end → duration

**Acceptance:**
- Admin can filter + quickly find errors
- Manifest readable without scrolling through raw logs

---

## Phase 3 — Traceability + Cost Signals

### 6) Add `traceId`
- Create `traceId` on export
- Pass to child jobs (thumb/proxy/envelope)
- UI filter by traceId

### 7) Add metrics rollups to manifest
- `metrics`: `{ ffmpegMs, s3BytesIn, s3BytesOut }`
- Derived from `s3Ops` + ffmpeg timings

**Acceptance:**
- Filter all logs for one export via traceId
- Basic cost estimate per job

---

## Phase 4 — Storage Mapping + Retention (Documentation + Report)

### 8) Add S3 storage map doc
- JSON registry of prefixes → purpose → retention

### 9) Optional nightly report script
- Summarize storage usage by prefix
- Highlight candidates for cleanup

**Acceptance:**
- Clear S3 structure map
- Ability to plan retention + GC

---

## Out of Scope
- Full event log table (cross-service tracing)
- Distributed tracing system

---

## Risks / Mitigations
- **Manifest size**: keep summaries concise, cap arrays.
- **Perf**: avoid heavy stringification in hot paths.

---

## Decision Points Before Implementation
- Do you want `traceId` generation in Phase 2 or Phase 3?
- Should storage map be markdown or JSON (for tooling)?
