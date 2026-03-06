# Observability

This app uses both DB-backed job records and telemetry data. They are intentionally complementary.

## Responsibility Matrix

- `media_jobs` + `media_job_attempts` (DB): durable product/admin truth.
- Logs (`pino`): event-level forensics and debugging.
- Traces/Metrics (OpenTelemetry): timing/throughput/failure trends and service-level analysis.

### DB (source of truth for `/admin/media-jobs`)

- Job identity/state: `id`, `type`, `status`, `attempts`, `max_attempts`, `error_code`, `error_message`.
- Timeline fields: `created_at`, `updated_at`, `completed_at`.
- Attempt timeline fields: `started_at`, `finished_at`.
- Durable attempt analytics:
  - `queue_wait_ms`
  - `duration_ms`
  - `input_bytes`
  - `output_bytes`
  - `error_class`
- Pointers to logs/artifacts: stdout/stderr S3 pointers and manifest pointers.

### Telemetry (OpenTelemetry)

- Root + stage spans for media jobs:
  - `mediajob.process`
  - `mediajob.fetch_inputs`
  - `mediajob.execute`
  - `mediajob.upload_outputs`
  - `mediajob.persist_results`
- Metrics:
  - `mediajob.duration_ms`
  - `mediajob.queue_wait_ms`
  - `mediajob.input_bytes`
  - `mediajob.output_bytes`
  - `mediajob.failures_total`
  - `mediajob.count_total`

## Reconciliation Guidance

When troubleshooting mismatches:

1. Treat DB as canonical for admin/product workflows.
2. Use trace + logs to explain *why* the DB row has its final state.
3. Compare metric aggregates against DB rollups over same window (type/status grouped).
4. If telemetry is missing (sampling/export outage), DB still remains complete.

## Environment Controls

- `OTEL_ENABLED=1` to enable OTel.
- `OTEL_EXPORTER_OTLP_ENDPOINT` to export remotely.
- Without endpoint, traces export to console in development.
- Logging level/format is controlled by `LOG_LEVEL` and `LOG_FORMAT`.
- `OTEL_INSTRUMENT_MYSQL2=0` to disable noisy DB auto-spans from mysql2 while keeping manual spans.
- `OTEL_INSTRUMENT_NET=0` (default) suppresses low-level `tcp.connect` spans from net instrumentation.
- `OTEL_TRACE_STATIC=0` (default) suppresses static asset request traces such as `/favicon.ico` and `/app/assets/*`.

## Local Jaeger (No Docker Required)

This repo includes helper scripts to install/run Jaeger all-in-one locally.

- Start Jaeger:
  - `npm run jaeger:start`
- Check status:
  - `npm run jaeger:status`
- Stop Jaeger:
  - `npm run jaeger:stop`
- View Jaeger logs:
  - `npm run jaeger:logs`

Jaeger endpoints:
- UI: `http://localhost:16686`
- OTLP HTTP: `http://localhost:4318`

Run app with OTLP export:

```bash
OTEL_ENABLED=1 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=aws-mediaconvert-service \
OTEL_SERVICE_VERSION=dev \
LOG_LEVEL=debug \
LOG_FORMAT=pretty \
npm run serve
```

Shortcut profile:

- `npm run serve:jaeger`
- Loads `.env.jaeger` if present, otherwise `.env.jaeger.example`.
- Override file path with `JAEGER_ENV_FILE=/path/to/file`.

## Daily Jaeger Workflow

1. Start Jaeger first:
   - `npm run jaeger:start`
2. Start app with OTLP enabled (example above).
3. Trigger a real workflow:
   - API request, `/create-video` export, or media job run.
4. Open Jaeger UI and query:
   - Service: `aws-mediaconvert-service`
   - Operation: `mediajob.process` (recommended for job-focused analysis)
   - Lookback: start with `Last 1h` or `Last 2h`
5. Expected behavior:
   - If Jaeger is restarted, previous traces disappear (in-memory storage).
   - With `limit=20`, results are the most recent 20 traces.
6. Shut down Jaeger when done:
   - `npm run jaeger:stop`
