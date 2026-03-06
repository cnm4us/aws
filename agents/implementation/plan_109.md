# Plan 109: App-Wide Observability (Pino + OpenTelemetry)

## Goal
Implement a production-grade observability baseline across the app:
- Structured logging with `pino` (server/workers).
- Distributed tracing + metrics with OpenTelemetry (server/workers).
- Keep existing browser `dlog` debug UX (`docs/DEBUG.md`) intact.

## Product/Engineering Decisions (Confirmed)
- Preserve frontend `dlog` for color-coded browser debugging.
- Replace server-side `console.*` usage with `pino` logger APIs.
- Use OpenTelemetry for backend traces/metrics, not as a replacement for app DB records.
- Keep `admin/mediajobs` DB records as source-of-truth for product/billing views.
- Route logs/traces by environment via ENV config (dev/staging/prod).

## Scope

### In scope
- Node API + worker observability foundation.
- Request/job correlation IDs in logs.
- Trace context in logs (`trace_id`, `span_id`).
- Media jobs spans + metrics for resource/billing analysis.
- ENV-based config matrix.
- Incremental `console.*` migration.

### Out of scope (initial rollout)
- Client-side telemetry ingestion from browser to backend.
- Full data warehouse/billing model redesign.
- Vendor lock-in decisions (Datadog/NewRelic/etc.) beyond OTLP compatibility.

---

## Architecture

## 1) Logging Layer (Pino)

### Logger module
Create a shared logger entrypoint (e.g. `src/lib/logger.ts`):
- Exports singleton root logger and helper `getLogger(context)`.
- Defaults:
  - dev: pretty transport + color.
  - staging/prod: JSON to `stdout`.
- Redaction:
  - `authorization`, `cookie`, `set-cookie`, tokens, secrets, API keys.
- Base fields:
  - `service`, `env`, `version`, `hostname`, `pid`.

### Request logger middleware
Express middleware:
- Attach/generate `request_id`.
- Bind child logger to `req.log`.
- Emit:
  - request start (optional, debug level)
  - request end with status, duration, bytes, route template.

### Worker/job logger binding
For media/job processing:
- Create job-scoped child logger:
  - `job_id`, `project_id`, `upload_id`, queue info.
- Log lifecycle transitions at `info`:
  - queued, started, progress milestones, completed, failed.

### Logging policy
- Use structured fields, not interpolated strings for key values.
- `debug`: high-volume diagnostics.
- `info`: lifecycle and business events.
- `warn/error`: degraded/failed states with error objects.

---

## 2) Tracing + Metrics Layer (OpenTelemetry)

### Bootstrap
Create OTel bootstrap (e.g. `src/lib/observability.ts`):
- Initialize NodeSDK once at process start.
- Instrumentations:
  - `http`, `express`, DB driver used by app, and relevant outbound libs.
- Exporters via OTLP (HTTP/gRPC) configurable by ENV.
- Resource attributes:
  - `service.name`, `service.version`, `deployment.environment`.

### Trace correlation in logs
Add log mixin/helper to include active span context:
- `trace_id`
- `span_id`
- `trace_flags`

### Media jobs tracing model
Define span hierarchy:
- root: `mediajob.process`
  - `mediajob.fetch_inputs`
  - `mediajob.ffmpeg.render`
  - `mediajob.upload_outputs`
  - `mediajob.persist_results`

Add span attributes:
- codec/profile/resolution/fps
- input/output bytes
- segment counts
- retry count
- failure classification

### Metrics (OTel)
Add core metrics:
- `mediajob.duration_ms` (histogram)
- `mediajob.queue_wait_ms` (histogram)
- `mediajob.input_bytes`, `mediajob.output_bytes` (histogram/counter)
- `mediajob.failures_total` by error class
- `http.server.duration` + request count/error count

---

## 3) Frontend Debug Interop

Keep `docs/DEBUG.md` workflow unchanged:
- `localStorage.DEBUG*`, namespaced `dlog`, styled browser console.
- No forced migration of browser debug to Pino.

Optional future enhancement:
- Add request/trace IDs to selected client debug lines for faster backend correlation.

---

## Environment Configuration

## Required ENV
- `APP_ENV` = `development|staging|production`
- `LOG_LEVEL` = `debug|info|warn|error`
- `LOG_FORMAT` = `pretty|json`
- `LOG_REDACT` = `1|0`
- `OTEL_ENABLED` = `1|0`
- `OTEL_SERVICE_NAME`
- `OTEL_SERVICE_VERSION`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS` (optional)
- `OTEL_TRACES_SAMPLER` (e.g. `parentbased_traceidratio`)
- `OTEL_TRACES_SAMPLER_ARG` (e.g. `1.0`, `0.2`, `0.05`)
- `OTEL_METRICS_ENABLED` = `1|0`

## Suggested defaults
- Development:
  - `LOG_FORMAT=pretty`, `LOG_LEVEL=debug`, `OTEL_ENABLED=1`, sample ratio `1.0`
- Staging:
  - `LOG_FORMAT=json`, `LOG_LEVEL=info`, sample ratio `0.2`
- Production:
  - `LOG_FORMAT=json`, `LOG_LEVEL=info`, sample ratio `0.05` (adjust after baseline)

---

## Rollout Plan

## Phase A — Inventory + Guardrails
- Inventory all `console.*` usage in backend/workers.
- Classify each call:
  - keep (rare bootstrap fallback only),
  - replace with logger,
  - remove dead debug noise.
- Add lint rule:
  - disallow `console.*` in server code except explicit allowlist.

Deliverables:
- inventory report (`agents/implementation/metrics/observability_console_inventory.md`)
- lint/update policy documented.

## Phase B — Pino Foundation
- Implement `src/lib/logger.ts`.
- Add Express request logging middleware.
- Add error logging helper standard (`err`, `code`, `status`, `context`).

Deliverables:
- logger module + middleware.
- startup logs include env/version.

## Phase C — Replace Console Logs (Backend)
- Replace `console.log/error/warn` in:
  1. media jobs path first,
  2. create-video routes/services,
  3. remaining API modules.
- Keep message parity where useful, but structured.

Deliverables:
- zero backend `console.*` (except approved fallback sites).

## Phase D — OTel Bootstrapping
- Add OTel SDK init + auto-instrumentations.
- Validate traces in local/dev collector.
- Add trace correlation to Pino logs.

Deliverables:
- request spans visible.
- logs include `trace_id`/`span_id`.

## Phase E — MediaJobs Deep Instrumentation
- Add manual spans for job stages.
- Add job-specific metrics.
- Add failure taxonomy attributes.

Deliverables:
- trace timeline for each media job.
- metrics usable for latency/failure/resource charts.

## Phase F — `admin/mediajobs` Alignment
- Ensure DB model captures durable analytics fields:
  - queue/start/end timestamps, bytes, duration, status, error class.
- Confirm reconciliation between:
  - DB source-of-truth
  - OTel metrics dashboards
  - logs for incident forensics.

Deliverables:
- documented “DB vs telemetry responsibility” matrix.

## Phase G — Staging/Prod Hardening
- Enable JSON logs + OTLP export in staging.
- Sampling/redaction review.
- Load test log volume + telemetry overhead.

Deliverables:
- approved env templates for staging/prod.
- runbook for incident triage.

## Phase H — Cleanup + Documentation
- Update:
  - `docs/DEBUG.md` (clarify browser debug remains separate)
  - new `docs/OBSERVABILITY.md` for backend logs/traces/metrics.
- Add quick commands for local tracing verification.

---

## Validation Checklist
- Request logs include `request_id`, method, route, status, duration.
- Error logs include structured `err` object and code.
- Backend has no unmanaged `console.*` calls.
- Traces visible for API requests and media jobs.
- Media job metrics visible and non-zero under test load.
- `admin/mediajobs` values still accurate and unchanged functionally.
- Frontend `dlog` flags/filters still work exactly as before.

---

## Risks / Tradeoffs
- Over-logging can increase cost/noise:
  - mitigate with levels, sampling, and field curation.
- Trace sampling too low may hide rare issues:
  - tune by route/job type.
- Redaction gaps can leak secrets:
  - enforce test coverage for known sensitive keys.

---

## Open Questions (Resolve Before Phase G)
- Final telemetry backend path (CloudWatch + ADOT, or OTLP collector -> other sink).
- Production sampling policy per endpoint/job type.
- Retention windows for logs/traces/metrics.

