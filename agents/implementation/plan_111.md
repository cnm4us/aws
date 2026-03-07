# Plan 111: Jaeger Service Performance Monitoring (SPM) with Prometheus

## Goal
Enable Jaeger SPM in our current EC2 dev environment so we can track service-level latency/error/rate trends over time (not just single traces), while keeping resource usage modest.

## Why This Is Worth Doing
- We already have useful traces and operation tags.
- SPM gives fast trend visibility for regressions:
  - request rate
  - error rate
  - latency percentiles
- This is especially useful while iterating on `/create-video`, exports, and media jobs.

## Environment Assumptions (Current Host Snapshot)
- Memory: ~`7.6 GiB` total, ~`5.0 GiB` available.
- Disk on `/`: ~`11 GiB` free.
- No swap currently configured.
- Workload target: short-term development observation, not long-term analytics retention.

## Confirmed Constraints
- Start with a development-first setup.
- Keep retention short.
- Keep labels low-cardinality to avoid metric explosion.
- Keep current Jaeger trace workflow intact.

---

## Target Architecture
1. App (`aws-mediaconvert-service`) exports OTLP to OTel Collector.
2. OTel Collector:
   - forwards traces to Jaeger collector,
   - generates span metrics via spanmetrics pipeline.
3. Prometheus scrapes Collector metrics endpoint.
4. Jaeger Query reads Prometheus as metrics backend for SPM UI.

Data flow:
- traces: `app -> otelcol -> jaeger`
- metrics: `otelcol(spanmetrics) -> prometheus -> jaeger-spm-query`

---

## Sizing and Guardrails (Dev Profile)
- Prometheus:
  - retention time: `48h`
  - retention size cap: `2GB`
  - scrape interval: `15s`
- OTel Collector:
  - spanmetrics flush interval: `30s`
  - minimal dimensions only
- Labels/dimensions allowed (initial):
  - `service.name`
  - `span.name` (or operation)
  - `status.code`
  - `http.method` (optional)
- Explicitly avoid in metrics dimensions:
  - user IDs, project IDs, upload IDs, raw URLs with IDs, request IDs.

---

## Phase A — Preflight + Compatibility Lock
1. Verify Jaeger all-in-one version/flags needed for Prometheus-backed SPM in our installed binary.
2. Lock the exact Jaeger flags/env vars for metrics storage integration.
3. Confirm OTel Collector version/config syntax for spanmetrics connector.
4. Add a compatibility note to docs with tested versions.

Deliverable:
- Version-locked config contract for Jaeger + Collector + Prometheus.

### Phase A Status (Completed: 2026-03-06)
- Jaeger binary verified:
  - `.tmp/jaeger/jaeger-all-in-one version` -> `v1.62.0`
  - `--prometheus.query.support-spanmetrics-connector` is not supported in this version.
  - SPM query options confirmed via env + `print-config`.
- OTel Collector verified:
  - Downloaded/tested `otelcol-contrib v0.139.0`.
  - `spanmetrics` connector present in component list.
  - spanmetrics pipeline config validated with `otelcol-contrib validate`.
- Prometheus verified:
  - Downloaded/tested `prometheus v2.55.1`.
  - retention flags confirmed (`retention.time`, `retention.size`).
- Docs updated:
  - `docs/OBSERVABILITY.md` now includes compatibility lock + exact env contract.

## Phase B — Prometheus Setup (Local Service on EC2)
1. Add scripts:
   - `scripts/prometheus.sh` (`start|stop|status|logs`)
2. Add config:
   - `ops/observability/prometheus.yml`
   - scrape targets:
     - collector spanmetrics endpoint
     - optional self-scrape for Prometheus health
3. Configure retention/time-size caps for dev profile.
4. Bind Prometheus to localhost by default.

Deliverable:
- Prometheus service managed similarly to Jaeger scripts, with bounded retention.

### Phase B Status (Completed: 2026-03-07)
- Added service helper:
  - `scripts/prometheus.sh` with `start|stop|status`
- Added npm commands:
  - `prometheus:start`
  - `prometheus:stop`
  - `prometheus:status`
  - `prometheus:logs`
- Added config:
  - `ops/observability/prometheus.yml`
  - scrapes `127.0.0.1:9090` and `127.0.0.1:8889`
- Enforced dev retention defaults:
  - time: `48h`
  - size: `2GB`
- Runtime validation passed:
  - start/status/stop executed successfully on this host.

## Phase C — OTel Collector Setup (Spanmetrics)
1. Add scripts:
   - `scripts/otelcol.sh` (`start|stop|status|logs`)
2. Add config:
   - `ops/observability/otelcol.yaml`
   - receivers: OTLP (HTTP + gRPC)
   - processors: batch + memory limiter
   - connector/pipeline: spanmetrics
   - exporters:
     - traces -> Jaeger collector
     - metrics -> Prometheus endpoint
3. Set conservative queue/batch limits.
4. Bind collector ports to localhost unless explicitly exposed.

Deliverable:
- Running collector that forwards traces and emits span-derived metrics for Prometheus scraping.

### Phase C Status (Completed: 2026-03-07)
- Added service helper:
  - `scripts/otelcol.sh` with `start|stop|status`
- Added npm commands:
  - `otelcol:start`
  - `otelcol:stop`
  - `otelcol:status`
  - `otelcol:logs`
- Added config:
  - `ops/observability/otelcol.yaml`
  - OTLP receivers on `127.0.0.1:5317` (gRPC) and `127.0.0.1:5318` (HTTP)
  - traces exporter to Jaeger OTLP gRPC `127.0.0.1:4317`
  - spanmetrics exporter on `127.0.0.1:8889` for Prometheus scrape
- Added safety processors:
  - `memory_limiter`
  - `batch`
- Runtime validation passed:
  - start/status/stop executed successfully on this host.
- Config note:
  - spanmetrics already includes core dimensions by default; only `http.method` is added as an extra dimension to avoid duplicates.

## Phase D — Wire App and Jaeger for SPM
1. Update dev env profile (`.env.jaeger.example`) to point app OTLP endpoint to collector, not directly to Jaeger.
2. Update Jaeger start command/script to enable Prometheus metrics backend for SPM.
3. Keep current trace UI behavior and search queries unchanged.
4. Confirm no regression in existing tags:
   - `app.operation`
   - `app.surface`

Deliverable:
- End-to-end SPM pipeline active without breaking trace search flow.

### Phase D Status (Completed: 2026-03-07)
- App export target updated for dev profile:
  - `.env.jaeger.example` now points to collector OTLP HTTP `http://127.0.0.1:5318`.
- Jaeger startup wiring updated for SPM:
  - `scripts/jaeger.sh` now sets SPM env defaults:
    - `METRICS_STORAGE_TYPE=prometheus`
    - `PROMETHEUS_SERVER_URL=http://127.0.0.1:9090`
    - `PROMETHEUS_QUERY_NAMESPACE=traces_span_metrics`
    - `PROMETHEUS_QUERY_NORMALIZE_CALLS=true`
    - `PROMETHEUS_QUERY_NORMALIZE_DURATION=true`
- Jaeger collector bind tightened to localhost:
  - `127.0.0.1:4317` / `127.0.0.1:4318`
- Runtime stack validation:
  - `jaeger:start`, `prometheus:start`, `otelcol:start` all succeeded.
  - Prometheus target health shows `up` for:
    - `prometheus`
    - `otelcol-spanmetrics`
- Existing app tagging codepaths were unchanged (`app.operation`, `app.surface`).

## Phase E — Validation and Query Playbook
1. Generate known traffic:
   - timeline patch events
   - one export enqueue/process
   - upload proxy/file fetch
2. Validate in Jaeger SPM:
   - services visible
   - operation latency/rate/error populated
3. Validate trace data still present and correlated.
4. Document expected warm-up delay for SPM graphs.

Deliverable:
- Verified SPM dashboards with reproducible test steps.

### Phase E Status (Completed: 2026-03-07)
- Generated validation traffic on local app (`/health`, `/create-video`, `/api/uploads/:id/file`).
- Confirmed Jaeger traces remain queryable:
  - service `aws-mediaconvert-service` present in `api/services`
  - recent traces returned from `api/traces`
- Confirmed existing span tags still present in traces:
  - `app.operation`
  - `app.surface`
- Confirmed spanmetrics generated and scraped:
  - collector endpoint `127.0.0.1:8889/metrics` includes:
    - `traces_span_metrics_calls_total`
    - `traces_span_metrics_duration_milliseconds_*`
  - Prometheus target health `up` for collector spanmetrics target.
- Confirmed Jaeger SPM metrics endpoints return operation-grouped data:
  - `/api/metrics/calls`
  - `/api/metrics/errors`
  - `/api/metrics/latencies` (tested with `quantile=0.95`)
- Added runbook query playbook and warm-up guidance to `docs/OBSERVABILITY.md`.

## Phase F — Runbook + Ops Hygiene
1. Update `docs/OBSERVABILITY.md`:
   - service startup order
   - stop/start/status/log commands
   - troubleshooting matrix (no data, missing service, high cardinality)
2. Add optional reverse-proxy note for Prometheus UI (if needed), default internal-only.
3. Add cleanup/rotation guidance for logs.
4. Add recommendation for small swap file (`1–2GB`) in dev for telemetry burst safety.

Deliverable:
- Clear operational runbook for day-to-day use.

### Phase F Status (Completed: 2026-03-07)
- Added stack orchestration helper:
  - `scripts/observability-stack.sh` (`start|stop|status|logs`)
- Added npm aliases:
  - `obs:start`
  - `obs:stop`
  - `obs:status`
  - `obs:logs`
- Expanded `docs/OBSERVABILITY.md` with:
  - startup/shutdown order
  - troubleshooting matrix
  - optional reverse-proxy hardening note
  - cleanup/reset commands
  - swap recommendation (`1G`–`2G`) with concrete commands

---

## Acceptance Criteria
- Jaeger SPM page shows service + operation charts populated from current app traffic.
- Existing Jaeger trace search remains functional.
- Resource usage remains acceptable on current EC2:
  - no sustained memory pressure
  - disk growth bounded by Prometheus retention cap.
- No high-cardinality label blowups in Prometheus.

## Rollback Plan
- Stop collector + Prometheus, revert app OTLP endpoint to Jaeger direct.
- Disable Jaeger Prometheus metrics backend flags.
- Keep all existing trace instrumentation and logs intact.

## Risks and Mitigations
- Risk: cardinality explosion -> high memory/disk.
  - Mitigation: strict dimensions whitelist, short retention.
- Risk: too many moving parts in dev.
  - Mitigation: scripts with `start|stop|status|logs`, documented startup order.
- Risk: version mismatch between Jaeger and Collector behavior.
  - Mitigation: explicit compatibility lock in Phase A.
