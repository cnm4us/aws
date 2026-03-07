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

High-value operation tags:
- `create_video.timeline.patch`
- `create_video.export.enqueue`
- `create_video.export.process` (media job execution)
- `uploads.file.get`
- `uploads.edit_proxy.get`
- `mediajobs.attempt.process`

Surface tag:
- `app.surface` (`create_video`, `assets`, `unknown`)

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
- `OTEL_INSTRUMENT_EXPRESS=0` (default) suppresses Express middleware/router child spans.
- `OTEL_INSTRUMENT_NET=0` (default) suppresses low-level `tcp.connect` spans from net instrumentation.
- `OTEL_TRACE_STATIC=0` (default) suppresses static asset request traces such as `/favicon.ico` and `/app/assets/*`.
- `OTEL_TRACE_PROBES=0` (default) suppresses scanner/probe traces such as `/.env`, `/.git/*`, `wp-*`, `xmlrpc.php`, etc.
- `OTEL_TRACE_ROOT=0` (default) suppresses `GET /` root traces by default.

## SPM Compatibility Lock (Phase A)

Tested baseline for Jaeger SPM on this repo:

- Jaeger all-in-one: `v1.62.0`
- OTel Collector Contrib: `v0.139.0`
- Prometheus: `v2.55.1`

### Jaeger `v1.62.0` notes

- Enable SPM metrics store via env (not CLI flags):
  - `METRICS_STORAGE_TYPE=prometheus`
  - `PROMETHEUS_SERVER_URL=http://127.0.0.1:9090`
- Use spanmetrics-compatible query settings:
  - `PROMETHEUS_QUERY_NAMESPACE=traces_span_metrics`
  - `PROMETHEUS_QUERY_NORMALIZE_CALLS=true`
  - `PROMETHEUS_QUERY_NORMALIZE_DURATION=true`
- `--prometheus.query.support-spanmetrics-connector` is **not** supported in this Jaeger version.
- Verification command:
  - `METRICS_STORAGE_TYPE=prometheus PROMETHEUS_SERVER_URL=http://127.0.0.1:9090 PROMETHEUS_QUERY_NAMESPACE=traces_span_metrics PROMETHEUS_QUERY_NORMALIZE_CALLS=true PROMETHEUS_QUERY_NORMALIZE_DURATION=true .tmp/jaeger/jaeger-all-in-one print-config`

### OTel Collector `v0.139.0` notes

- `spanmetrics` connector is present (`traces -> metrics`, alpha stability).
- Config shape validated with:
  - `otelcol-contrib validate --config <file>`
- Pipeline contract:
  - traces pipeline exports to `otlp/jaeger` + `spanmetrics`
  - metrics pipeline receives from `spanmetrics` and exports via `prometheus`

### Prometheus `v2.55.1` notes

- Retention controls confirmed:
  - `--storage.tsdb.retention.time`
  - `--storage.tsdb.retention.size`
- Dev defaults for this project:
  - retention time: `48h`
  - retention size cap: `2GB`
  - scrape interval: `15s`

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
- OTLP HTTP ingest (from collector): `http://localhost:4318`

Collector endpoint for app OTLP export:
- `http://127.0.0.1:5318`

Run app with OTLP export:

```bash
OTEL_ENABLED=1 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:5318 \
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

## Command Cheat Sheet

- Start Jaeger:
  - `npm run jaeger:start`
- Stop Jaeger:
  - `npm run jaeger:stop`
- Jaeger status:
  - `npm run jaeger:status`
- Tail Jaeger logs:
  - `npm run jaeger:logs`
- Start Prometheus:
  - `npm run prometheus:start`
- Stop Prometheus:
  - `npm run prometheus:stop`
- Prometheus status:
  - `npm run prometheus:status`
- Tail Prometheus logs:
  - `npm run prometheus:logs`
- Start OTel Collector:
  - `npm run otelcol:start`
- Stop OTel Collector:
  - `npm run otelcol:stop`
- OTel Collector status:
  - `npm run otelcol:status`
- Tail OTel Collector logs:
  - `npm run otelcol:logs`
- Start full observability stack:
  - `npm run obs:start`
- Stop full observability stack:
  - `npm run obs:stop`
- Full stack status:
  - `npm run obs:status`
- Tail all stack logs:
  - `npm run obs:logs`
- Start app with Jaeger profile:
  - `npm run serve:jaeger`
- Start app with explicit flags:
  - `OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:5318 OTEL_SERVICE_NAME=aws-mediaconvert-service OTEL_SERVICE_VERSION=dev OTEL_INSTRUMENT_MYSQL2=0 OTEL_INSTRUMENT_EXPRESS=0 OTEL_INSTRUMENT_NET=0 OTEL_TRACE_STATIC=0 OTEL_TRACE_PROBES=0 OTEL_TRACE_ROOT=0 LOG_LEVEL=debug LOG_FORMAT=pretty npm run serve`

## Local Prometheus (Phase B)

This repo now includes a Prometheus helper with a dev-focused retention profile.

- Config path:
  - `ops/observability/prometheus.yml`
- Default listen:
  - `127.0.0.1:9090`
- Default retention:
  - `48h` and `2GB` cap
- Default scrape:
  - `15s`
- Scrape targets:
  - Prometheus itself (`127.0.0.1:9090`)
  - OTel Collector spanmetrics endpoint (`127.0.0.1:8889`)

Environment overrides for script:
- `PROM_CONFIG_FILE`
- `PROM_VERSION`
- `PROM_RETENTION_TIME`
- `PROM_RETENTION_SIZE`
- `PROM_LISTEN_ADDRESS`

## Local OTel Collector (Phase C)

Collector config:
- `ops/observability/otelcol.yaml`

Default endpoints:
- OTLP gRPC receiver: `127.0.0.1:5317`
- OTLP HTTP receiver: `127.0.0.1:5318`
- spanmetrics Prometheus exporter: `127.0.0.1:8889`
- Jaeger OTLP gRPC export target: `127.0.0.1:4317`

Pipeline:
- traces in via OTLP receiver
- traces out to Jaeger + spanmetrics connector
- spanmetrics out via Prometheus exporter

Environment overrides for script:
- `OTELCOL_CONFIG_FILE`
- `OTELCOL_VERSION`

## SPM Validation (Phase E)

Startup order:
1. `npm run jaeger:start`
2. `npm run prometheus:start`
3. `npm run otelcol:start`
4. `npm run serve:jaeger`

Generate sample traffic (example):
- `curl -fsS http://127.0.0.1:3300/health`
- `curl -fsS http://127.0.0.1:3300/create-video`
- `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3300/api/uploads/1/file`

Warm-up expectation:
- spanmetrics flush interval (`30s`) + Prometheus scrape interval (`15s`) means SPM data can take ~`45–90s` to appear consistently.

Quick checks:
- Prometheus target health:
  - `curl -fsS http://127.0.0.1:9090/api/v1/targets`
- Spanmetrics present:
  - `curl -fsS http://127.0.0.1:8889/metrics | rg traces_span_metrics_calls_total`
- Jaeger traces present:
  - `curl -fsS "http://127.0.0.1:16686/api/traces?service=aws-mediaconvert-service&lookback=1h&limit=5"`

SPM API checks (same data backing the Jaeger SPM UI):
- Calls:
  - `curl -fsS "http://127.0.0.1:16686/api/metrics/calls?service=aws-mediaconvert-service&lookback=3600000&step=60000&ratePer=60&groupByOperation=true"`
- Errors:
  - `curl -fsS "http://127.0.0.1:16686/api/metrics/errors?service=aws-mediaconvert-service&lookback=3600000&step=60000&ratePer=60&groupByOperation=true"`
- Latency (p95):
  - `curl -fsS "http://127.0.0.1:16686/api/metrics/latencies?service=aws-mediaconvert-service&lookback=3600000&step=60000&quantile=0.95&groupByOperation=true"`

Parameter units:
- `lookback`: milliseconds
- `step`: milliseconds
- `ratePer`: seconds

## Phase F Runbook (Ops Hygiene)

Recommended local startup order:
1. `npm run obs:start`
2. `npm run serve:jaeger`

Recommended local shutdown order:
1. stop app process
2. `npm run obs:stop`

Troubleshooting matrix:

| Symptom | Quick check | Likely cause | Fix |
|---|---|---|---|
| No traces in Jaeger | `npm run jaeger:status` and app log `otel.started` | app not exporting or Jaeger down | ensure `OTEL_ENABLED=1`, start Jaeger |
| Traces visible, SPM empty | `curl http://127.0.0.1:9090/api/v1/targets` | collector/prometheus not running, or warm-up window | start `otelcol` and `prometheus`, wait 45–90s |
| Prometheus target `down` for `otelcol-spanmetrics` | `npm run otelcol:status` | collector not listening on `:8889` | restart collector and recheck config |
| Jaeger SPM API returns parse errors | check query params | wrong units (`lookback`, `ratePer`) | use ms for lookback/step, seconds for ratePer |
| High memory/disk usage | `free -h` and `du -sh .tmp/prometheus/data` | retention too high / high-cardinality labels | keep 48h/2GB, avoid high-cardinality dimensions |

Optional reverse proxy note:
- Keep Prometheus and collector bound to `127.0.0.1` by default.
- If Prometheus UI is exposed via Nginx, protect it (IP allowlist or auth).

Cleanup / reset commands:
- Stop stack: `npm run obs:stop`
- Clear Prometheus TSDB (dev reset): `rm -rf .tmp/prometheus/data`
- Clear downloaded binaries/logs if needed:
  - `rm -rf .tmp/prometheus .tmp/otelcol`
  - `rm -f logs/prometheus.log logs/otelcol.log logs/jaeger.log`

Swap recommendation for this host:
- Add a small swap file (`1G`–`2G`) to reduce OOM risk during telemetry spikes.
- Example (`2G`):
  - `sudo fallocate -l 2G /swapfile`
  - `sudo chmod 600 /swapfile`
  - `sudo mkswap /swapfile`
  - `sudo swapon /swapfile`
  - `echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`

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

## Tag Reference

## Common query tags
- `app.operation`
- `app.surface`
- `mediajob_type`
- `mediajob_status`
- `mediajob_id`
- `error_code`

## `app.operation` values currently emitted
- `create_video.timeline.patch`
- `create_video.export.enqueue`
- `create_video.export.process`
- `uploads.file.get`
- `uploads.edit_proxy.get`
- `mediajobs.attempt.process`

## `app.surface` values currently emitted
- `create_video`
- `assets`
- `unknown`

## Request classification tag
- `app.request.class=static_asset` for static resources (when static traces are enabled with `OTEL_TRACE_STATIC=1`).
- `app.request.class=probe` for scanner/probe paths (when enabled with `OTEL_TRACE_PROBES=1`).
- `app.request.class=root` for `GET /` root requests (when enabled with `OTEL_TRACE_ROOT=1`).
