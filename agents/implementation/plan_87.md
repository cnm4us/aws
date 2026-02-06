# Plan 87 — MediaJobs Resource Metrics for Capacity Planning

## Goal
Add lightweight, actionable metrics to MediaJobs so we can estimate per‑job cost/throughput and size spot fleets for ffmpeg workloads. Focus on **RTF (real‑time factor), CPU/mem usage, I/O hints, and input characteristics**.

## Scope (Phase 1)
- Log per‑attempt timing and derived RTF.
- Log input characteristics (duration, codec, resolution, bitrate) for ffmpeg jobs.
- Log host metadata (instance type, cores, RAM) once per worker.
- Surface the above in MediaJobs UI (Attempt Manifest + summary badges).

## Non‑Goals (Phase 1)
- Full distributed tracing / external telemetry systems.
- Per‑frame profiling.
- Cost accounting across S3 / egress (defer).

---

## Data Model Changes
1) **MediaJobAttempt manifest**: add `metrics` object.
   - `metrics.durationMs` (already present)
   - `metrics.rtf` (inputDurationSeconds / durationSeconds)
   - `metrics.input`:
     - `durationSeconds`
     - `videoCodec` / `audioCodec`
     - `width` / `height`
     - `bitrateKbps` (if available)
   - `metrics.host`:
     - `instanceType` (from env or AWS metadata)
     - `cpuCores`
     - `memGb`
     - `hostname`

2) **Job type coverage** (Phase 1):
   - `create_video_export_v1`
   - `upload_edit_proxy_v1`
   - `upload_thumb_v1`
   - `upload_audio_envelope_v1`

---

## Implementation Steps

### 1) Metrics extraction helpers
- Add a helper in `src/services/ffmpeg/metrics.ts`:
  - `probeMediaInfo(path): {durationSeconds, width, height, videoCodec, audioCodec, bitrateKbps}`
  - Use `ffprobe` (already available in stack).
  - Cache probe results per path per job to avoid repeated calls.

### 2) Worker host metadata
- Add `getHostMetrics()` helper in `src/services/mediaJobs/worker.ts`:
  - `cpuCores`: `os.cpus().length`
  - `memGb`: `Math.round(os.totalmem() / 1e9 * 10) / 10`
  - `hostname`: `os.hostname()`
  - `instanceType`: from `process.env.AWS_INSTANCE_TYPE` or IMDS (optional; if unavailable, set `null`).

### 3) Job‑specific metrics collection
- For each ffmpeg job type:
  - Determine the **primary input file** (the source that defines job duration).
  - Run `probeMediaInfo` before job starts; store in `attempt.manifest.metrics.input`.
  - After job completion, compute `rtf` using `durationMs` and `input.durationSeconds`.

### 4) Persist & surface
- Add `metrics` to attempt manifest JSON (same place as `ffmpegCommands`).
- Update MediaJobs admin UI:
  - Show `RTF` badge (e.g. `RTF 1.3x`)
  - Show input summary (e.g. `1080x1920 H.264 AAC, 2:30`)
  - Show host badge if present (`c7i.large, 2 cores, 4GB`).

### 5) Validation
- Run a couple of ffmpeg jobs and confirm:
  - Manifest includes metrics.
  - RTF looks sane (0.5–2.5 typical).

---

## Optional Phase 2
- Per‑job CPU/mem sampling during run (lightweight):
  - Sample every 2s, keep max/avg, store `metrics.cpuPctAvg`, `metrics.memRssMbMax`.
- Add S3 object size to metrics for output file.
- Add aggregated dashboard (later).

---

## Open Questions
1) **IMDS access**: Use IMDS for `instanceType` when env var missing.
2) **Retention**: Keep metrics indefinitely for now (manual purge).
3) **UI placement**: Add compact summary to job list + full details in Attempt Manifest.

---

## Rollback Plan
- If probes cause overhead, wrap them in a feature flag (`MEDIAJOB_METRICS=1`).
