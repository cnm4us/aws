# Plan 112: External Provider Telemetry (AssemblyAI + MediaConvert)

## Goal
Instrument outbound provider calls so Jaeger and Prometheus show:
- where third-party time is spent,
- which provider operation failed,
- retry/outcome behavior,
while keeping `/admin/media-jobs` as the durable source of truth.

This plan extends observability; it does **not** replace MediaJobs records.

## Why This Matters
- Today, MediaJobs tells us **what** happened to a job.
- We still need traces/metrics to show **where time and errors happen** inside provider integrations.
- External operations (captioning + transcoding) are high-cost and high-latency, so they should be first-class telemetry entities.

## Scope
- Provider client paths:
  - AssemblyAI (`src/services/assemblyai.ts`)
  - AWS MediaConvert create/status calls (`src/services/productionRunner.ts`, `src/server-main.ts`, media-jobs worker paths)
- Correlate with existing:
  - `mediajob.*` spans/metrics
  - `app.operation` labels
  - `/admin/media-jobs` DB data

Out of scope for this plan:
- Direct instrumentation inside external services (not possible from our app side).
- Replacing MediaJobs DB/UI workflow.

---

## Phase A Findings (Call-Site Inventory + Context Mapping)

### External Operation Matrix

| Provider | External operation | Current call-site(s) | Trigger context | Expected root span | Notes |
|---|---|---|---|---|---|
| AssemblyAI | `transcript.create` | `src/services/assemblyai.ts#createTranscript` called by `src/media/jobs/assemblyAiTranscriptV1.ts` and `src/media/jobs/assemblyAiUploadTranscriptV1.ts` | MediaJobs worker (`assemblyai_transcript_v1`, `assemblyai_upload_transcript_v1`) | `mediajob.process` | One call per job attempt; submit URL is pre-signed S3 media URL. |
| AssemblyAI | `transcript.status.get` | `src/services/assemblyai.ts#getTranscriptStatus` via `waitForTranscript` loop | MediaJobs worker | `mediajob.process` | Repeated poll calls; needs low-noise strategy + outcome tags. |
| AssemblyAI | `transcript.vtt.get` | `src/services/assemblyai.ts#fetchVtt` | MediaJobs worker | `mediajob.process` | Called after terminal `completed`; returns VTT body. |
| MediaConvert | `job.create` | `src/services/productionRunner.ts#startMediaConvertForExistingProduction` | (a) API request flow via `src/features/productions/service.ts` create/publish, (b) MediaJobs worker orchestration (`audio_master_v1`, `video_master_v1`) | (a) `HTTP <METHOD> <route>`, (b) `mediajob.process` | Same external op appears in 2 contexts; must tag context/source. |
| MediaConvert | `job.get` | `src/server-main.ts#pollStatuses` (`GetJobCommand`) | Background poll timer (non-request path) | new poll root span (to be added) | Poll loop fans out per job id and updates uploads/productions statuses. |

### Context/Correlation Source Map
- `mediajob.id`, `mediajob.type`, `mediajob.attempt_no`: available in worker paths (AssemblyAI jobs + master jobs).
- `production_id`, `upload_id`: available in production service + worker orchestration + poll status update.
- `mediaconvert_job_id`: available at create return and poll-time lookup.
- `assemblyai_transcript_id`: available after transcript create.
- `app.operation` seeds already present for worker root; external child spans inherit/extend.

### Async Turnaround Metric Anchors (for later phases)
- `external.job.turnaround_ms` (AssemblyAI):
  - start: successful `transcript.create`
  - end: terminal result from `waitForTranscript` (`completed`/`error`/`timeout`)
- `external.job.turnaround_ms` (MediaConvert):
  - start: successful `job.create`
  - end: first terminal status observed in poller (`COMPLETE`/`ERROR`/`CANCELED`)
  - source of linkage: `mediaconvert_job_id`

### Inventory Decisions
- Include only runtime service paths in scope.
- Exclude CLI tooling path `src/tools/mediaconvert/create-job.ts` from plan implementation.
- Keep `/admin/media-jobs` unchanged; use it for durable state while traces/metrics provide latency/error insight.

### Phase A Status
- Completed: operation matrix established, contexts mapped, turnaround anchors defined.

---

## Telemetry Contract (Target)

### Span naming
- `external.assemblyai.transcript.create`
- `external.assemblyai.transcript.status.get`
- `external.assemblyai.transcript.vtt.get`
- `external.mediaconvert.job.create`
- `external.mediaconvert.job.get`

### Core span attributes
- `external.provider`: `assemblyai` | `aws_mediaconvert`
- `external.operation`: stable operation id
- `external.system`: `http` | `aws_sdk`
- `app.operation`: existing app/mediajob operation label
- `app.surface`: where available
- `mediajob.id`, `mediajob.type`, `mediajob.attempt_no` when in worker context
- `http.status_code` (for AssemblyAI HTTP calls)
- `aws.region` (for MediaConvert calls)
- `external.request_id` or provider job/transcript id where available

### Outcome attributes
- `app.outcome`: `success` | `redirect` | `client_error` | `server_error`
- `error.class`: normalized (`timeout`, `upstream`, `validation`, `auth`, `rate_limit`, etc.)
- `external.retry_count` (if retry wrapper used)

### Metrics (phase 3/4)
- Counter: `external.calls_total` by provider/operation/outcome
- Histogram: `external.duration_ms` by provider/operation
- Counter: `external.errors_total` by provider/operation/error.class
- Histogram: `external.job.turnaround_ms` for async provider jobs (submit -> terminal state)

All labels remain low-cardinality (no raw URLs with IDs, no user text).

---

## Phase A — Inventory + Context Mapping
1. Build a call-site map for every provider call:
   - AssemblyAI create/status/vtt
   - MediaConvert create/get
2. Mark each call-site context:
   - request path vs media-job worker vs background poller
3. Define where correlation attributes come from (request, job row, payload).
4. Produce a final operation matrix in this file before coding.

Deliverable:
- Confirmed mapping from app workflows to external operations.

### Phase A Status (Completed: 2026-03-07)
- Added operation inventory and context matrix in this plan.
- Mapped trigger contexts (request, worker, background poller).
- Defined correlation fields and turnaround metric anchors.

## Phase B — Shared External Span Helper
1. Add a small helper in `src/lib/observability` (or `src/services/mediaJobs/observability.ts` adjunct) to wrap external calls with:
   - consistent span naming,
   - uniform attributes,
   - automatic status/outcome/error tagging.
2. Add provider error normalization utility:
   - timeout/network/auth/rate-limit/not-found/upstream/internal.
3. Ensure helper works in both:
   - HTTP fetch workflows (AssemblyAI),
   - AWS SDK command workflows (MediaConvert).

Deliverable:
- Reusable instrumentation primitive for outbound integrations.

### Phase B Status (Completed: 2026-03-07)
- Added shared helper module: `src/lib/externalObservability.ts`
- Implemented wrappers:
  - `withExternalSpan(...)` (generic)
  - `withExternalHttpSpan(...)` (fetch/HTTP response aware)
  - `withExternalAwsSpan(...)` (AWS SDK metadata aware)
- Added normalized provider error classification:
  - `classifyExternalErrorClass(...)` with timeout/network/auth/rate_limit/validation/not_found/upstream mapping.
- Added uniform outcome/status tagging:
  - `app.outcome`
  - `error.class`
  - `http.status_code` (when available)
  - `external.request_id` (when available)

## Phase C — Instrument AssemblyAI Paths
1. Instrument `assemblyFetch` in `src/services/assemblyai.ts`:
   - per-call spans with method + path template,
   - status and error class tags.
2. Add operation tags in high-level functions:
   - `createTranscript`
   - `getTranscriptStatus`
   - `fetchVtt`
3. Propagate mediajob context attributes from AssemblyAI job runners:
   - `src/media/jobs/assemblyAiTranscriptV1.ts`
   - `src/media/jobs/assemblyAiUploadTranscriptV1.ts`

Deliverable:
- Jaeger can show caption-provider latency/failure per operation and per job context.

### Phase C Status (Completed: 2026-03-07)
- Instrumented AssemblyAI service calls with external spans in `src/services/assemblyai.ts`:
  - `external.assemblyai.transcript.create`
  - `external.assemblyai.transcript.status.get`
  - `external.assemblyai.transcript.vtt.get`
- Added optional telemetry context propagation through:
  - `createTranscript(...)`
  - `getTranscriptStatus(...)`
  - `waitForTranscript(...)`
  - `fetchVtt(...)`
- Propagated mediajob context attributes from job runners:
  - `src/media/jobs/assemblyAiTranscriptV1.ts`
  - `src/media/jobs/assemblyAiUploadTranscriptV1.ts`
- Worker now passes job-level attributes into AssemblyAI runners:
  - `mediajob_id`
  - `mediajob_attempt_no`
  - `mediajob_type`

## Phase D — Instrument MediaConvert Paths
1. Wrap `CreateJobCommand` in `src/services/productionRunner.ts`.
2. Wrap `GetJobCommand` poll paths in `src/server-main.ts`.
3. Add attributes:
   - region, queue ARN hash/safe identifier, operation name, outcome, error class.
4. Attach/propagate existing business context:
   - upload id, production id, mediajob id when available.

Deliverable:
- Jaeger can separate submit-time vs poll-time MediaConvert behavior.

### Phase D Status (Completed: 2026-03-07)
- Instrumented MediaConvert create-job path in `src/services/productionRunner.ts`:
  - wrapped `CreateJobCommand` with `withExternalAwsSpan(...)`
  - span name: `external.mediaconvert.job.create`
  - operation: `job.create`
  - attributes include region, queue label, production/upload context.
- Instrumented MediaConvert poll path in `src/server-main.ts`:
  - wrapped `GetJobCommand` with `withExternalAwsSpan(...)`
  - span name: `external.mediaconvert.job.get`
  - operation: `job.get`
  - attributes include region and bucket context counts (+ first upload/production id when present).

## Phase E — Metrics + Prometheus Rules
1. Emit external-call metrics (`external.calls_total`, `external.duration_ms`, `external.errors_total`).
2. Emit async provider turnaround metric:
   - `external.job.turnaround_ms`
   - scope: AssemblyAI transcript jobs + MediaConvert jobs
   - definition: first submit timestamp to terminal status timestamp
   - labels: provider, operation family, outcome (no raw IDs)
3. Add recording rules for top provider operations:
   - p95 latency
   - error rate
   - calls/sec
4. Add alert rules with operation-specific thresholds (not one global threshold):
   - example: MediaConvert poll p95 high
   - example: AssemblyAI status error-rate high
   - example: provider turnaround p95 high

Deliverable:
- Prometheus provides provider-level SLO signals.

### Phase E Status (Completed: 2026-03-07)
- External call metrics now derive from external client spans via spanmetrics recording rules:
  - `external:calls_per_second:5m`
  - `external:errors_per_second:5m`
  - `external:error_rate:5m`
  - `external:p95_latency_ms:30m`
- Added async turnaround spans/metric path:
  - AssemblyAI turnaround span: `external.assemblyai.transcript.turnaround`
  - MediaConvert turnaround span: `external.mediaconvert.job.turnaround`
  - recording rule: `external:job_turnaround_p95_ms:30m`
- Added external alert rules:
  - `ExternalProviderErrorRateHigh`
  - `ExternalProviderTurnaroundHigh`

## Phase F — Correlation with MediaJobs + Runbook
1. Update `docs/OBSERVABILITY.md`:
   - query patterns linking traces to `/admin/media-jobs`.
2. Add “triage flow”:
   - start from failed MediaJob row -> trace by ids/timestamps -> provider span.
3. Add examples:
   - AssemblyAI timeout diagnosis
   - MediaConvert submit vs poll failure diagnosis

Deliverable:
- Repeatable troubleshooting path from admin UI to trace details.

---

## Acceptance Criteria
- For one caption job and one transcode job, Jaeger shows explicit external spans with provider/operation labels.
- External spans include normalized outcomes and error classes.
- Prometheus exposes provider operation latency/error metrics.
- `/admin/media-jobs` remains unchanged as source of truth, but correlation to traces is documented and practical.

## Rollback Plan
- Feature-flag external call instrumentation with `OTEL_TRACE_EXTERNAL=0|1` (default `1` in dev).
- If needed, disable external metrics emission separately with `OTEL_METRICS_EXTERNAL=0|1`.
- Keep MediaJobs DB pipeline untouched.

## Risks + Mitigations
- Risk: higher trace volume from polling loops.
  - Mitigation: sample or aggregate low-value poll spans; keep labels low-cardinality.
- Risk: accidental high-cardinality tags (raw URLs/IDs).
  - Mitigation: path templates + strict attribute whitelist.
- Risk: sensitive data leakage (headers/tokens).
  - Mitigation: never attach auth headers or full provider payloads to spans/logs.
