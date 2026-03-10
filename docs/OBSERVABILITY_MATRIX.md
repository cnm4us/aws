# Observability Matrix

Last updated: 2026-03-10

This matrix is the canonical lookup for **application-defined observability tags** emitted by this codebase.

Scope notes:
- This file covers custom tags emitted by app code (`app.*`, `error.*`, `external.*`, `mediajob_*`, `storage_*`, `subprocess.*`, and a few IDs/context tags).
- Auto-instrumentation tags from OpenTelemetry libraries (for example `http.*`, `net.*`, `otel.*`) are intentionally not exhaustively enumerated here.
- Some tags are inherently dynamic; those are listed with format/range constraints.

## Tag Matrix

| Tag key | Possible values | Type | Notes |
|---|---|---|---|
| `app.operation` | See full catalog below | enum | Primary operation name for traces/metrics queries. |
| `app.operation_family` | `mediajobs.attempt.process` | enum | Grouping for media job operation families. |
| `app.surface` | `create_video`, `assets`, `admin`, `global_feed`, `unknown` | enum | User surface derived from route/referer context. |
| `app.outcome` | `success`, `redirect`, `client_error`, `server_error` | enum | Derived from HTTP status or explicit span outcome. |
| `app.request.class` | `static_asset`, `probe`, `root` | enum | Set only when trace toggles include those classes. |
| `error.class` | `validation`, `auth`, `forbidden`, `not_found`, `conflict`, `rate_limit`, `upstream`, `internal`, `client`, `timeout`, `network` | enum | Some values are route-status-derived; others from external error classification. |
| `http.status_code` | `100..599` | integer | Set by HTTP/external spans. |
| `storage_backend` | `s3` | enum | S3 existence-check instrumentation. |
| `storage_check` | `head_object` | enum | S3 existence-check operation type. |
| `storage_object_kind` | `upload_edit_proxy`, `upload_thumb`, `upload_audio_envelope`, `freeze_frame_image` | enum | Object classes checked via S3 HeadObject. |
| `storage_exists` | `true`, `false` | boolean | Result of storage check. |
| `storage_missing_expected` | `true`, `false` | boolean | Whether missing object is expected/normal. |
| `storage_lookup_result` | `exists`, `missing_expected`, `error_unexpected` | enum | Normalized lookup result classification. |
| `external.provider` | `assemblyai`, `aws.mediaconvert` | enum | External provider family. |
| `external.operation` | `transcript.create`, `transcript.status.get`, `transcript.vtt.get`, `transcript.turnaround`, `job.create`, `job.get`, `job.turnaround` | enum | Provider operation granularity. |
| `external.system` | `http`, `aws_sdk` | enum | External transport/system type. |
| `external.request_id` | non-empty string | string | Upstream request id when available. |
| `sink_provider` | `none`, `posthog` | enum | Optional analytics sink provider. |
| `sink_outcome` | `success`, `failure`, `dropped_disabled`, `dropped_sampled`, `dropped_provider`, `dropped_misconfigured`, `dropped_invalid_event` | enum | Dispatch/drop status for optional analytics sink. |
| `subprocess.name` | `ffmpeg`, `ffprobe` | enum | Local subprocess command family. |
| `subprocess.exec_mode` | `local`, `remote` | enum | Current code emits `local`; `remote` reserved for future worker offload. |
| `subprocess.command_label` | non-empty string | string | Optional human label for ffmpeg command group. |
| `subprocess.args_count` | `0..n` | integer | Number of args passed to subprocess invocation. |
| `subprocess.purpose` | See dedicated catalog below | enum | Purpose-level classifier for ffmpeg/ffprobe invocations. |
| `subprocess.exit_code` | integer | integer | Process exit code when available. |
| `subprocess.success` | `true`, `false` | boolean | Process success flag. |
| `subprocess.handled_nonzero` | `true`, `false` | boolean | Marks expected/non-fatal nonzero outcomes. |
| `mediajob.status` | `completed`, `failed`, `dead`, `unknown` | enum | Final status on mediajob span annotation. |
| `mediajob.error_code` | non-empty string | string | Error code captured when available. |
| `mediajob.duration_ms` | `>= 0` | number | Job duration in milliseconds. |
| `mediajob.queue_wait_ms` | `>= 0` | number | Queue wait duration in milliseconds. |
| `mediajob.input_bytes` | `>= 0` | number | Input bytes consumed by job. |
| `mediajob.output_bytes` | `>= 0` | number | Output bytes produced by job. |
| `mediajob_type` | See dedicated catalog below | enum | Job type dimension used in spans/metrics. |
| `mediajob_status` | `completed`, `failed`, `dead`, `unknown` | enum | Metrics label form of mediajob status. |
| `mediajob_id` | positive integer | integer | Media job id. |
| `mediajob_attempt_no` | positive integer | integer | Attempt sequence number. |
| `mediajob_attempt_id` | positive integer | integer | Attempt row id. |
| `mediajob_queue` | non-empty string | string | Queue name when present. |
| `worker_id` | non-empty string | string | Worker host/process identity. |
| `project_id` | positive integer | integer | Project id when context available. |
| `upload_id` | positive integer | integer | Upload id when context available. |
| `error_code` | non-empty string | string | Metrics label (primarily mediajob failures). |

## `app.operation` Catalog

### Create Video API operations
- `create_video.project.active.ensure`
- `create_video.project.active.get`
- `create_video.project.active.archive`
- `create_video.projects.list`
- `create_video.projects.create`
- `create_video.projects.get`
- `create_video.projects.patch`
- `create_video.projects.delete`
- `create_video.projects.archive`
- `create_video.timeline.patch`
- `create_video.export.enqueue`
- `create_video.export.status`
- `create_video.screen_titles.render`
- `create_video.narration.sign`
- `create_video.narration.list`
- `create_video.narration.patch`
- `create_video.narration.delete`
- `create_video.audio.sign`
- `create_video.audio.list`
- `create_video.audio.patch`
- `create_video.audio.delete`
- `create_video.exports.hls_status.get`
- `create_video.exports.hls_prep.post`

### Uploads / assets operations
- `uploads.list`
- `uploads.summary.get`
- `uploads.get`
- `uploads.patch`
- `uploads.delete`
- `uploads.file.get`
- `uploads.edit_proxy.get`
- `uploads.audio_envelope.get`
- `uploads.thumb.get`
- `uploads.thumb.refresh`
- `uploads.publish_options.get`
- `uploads.delete_source`
- `uploads.freeze_frame`
- `assets.videos.list`
- `assets.videos.favorite`
- `assets.videos.used`
- `assets.graphics.list`
- `assets.graphics.favorite`
- `assets.graphics.used`
- `assets.audio.system.list`
- `assets.audio.system.search`
- `assets.audio.system.favorite`
- `assets.audio.tags.list`

### Library / visualizer operations
- `library.source_orgs.list`
- `library.videos.list`
- `library.videos.get`
- `library.videos.captions`
- `library.videos.search`
- `library.clips.list`
- `library.clips.create`
- `library.clips.get`
- `library.clips.patch`
- `library.clips.delete`
- `library.clips.favorite`
- `visualizer_presets.list`
- `visualizer_presets.create`
- `visualizer_presets.get`
- `visualizer_presets.patch`
- `visualizer_presets.delete`
- `visualizer_presets.reset`

### Prompt / admin operations
- `admin.prompts.list`
- `admin.prompts.get`
- `admin.prompts.write`
- `admin.prompt_rules.list`
- `admin.prompt_rules.get`
- `admin.prompt_rules.write`
- `feed.global.list`
- `feed.prompt.decide`
- `feed.prompt.fetch`
- `feed.prompt.event`
- `feed.activity.event`
- `feed.activity.ingest`
- `feed.activity.query`
- `prompt.analytics.ingest`
- `prompt.analytics.query`
- `analytics.sink.dispatch`
- `analytics.sink.health`

### Media job operations
- `create_video.export.process`
- `mediajobs.attempt.process`

### External provider operations (app.operation label form)
- `external.assemblyai.transcript.create`
- `external.assemblyai.transcript.status.get`
- `external.assemblyai.transcript.vtt.get`
- `external.assemblyai.transcript.turnaround`
- `external.mediaconvert.job.create`
- `external.mediaconvert.job.get`
- `external.mediaconvert.job.turnaround`

### Subprocess operations
- `subprocess.ffmpeg.run`
- `subprocess.ffprobe.run`

## `subprocess.purpose` Catalog

- `detect_initial_non_silence`
- `has_audio_stream`
- `probe_duration_seconds`
- `probe_media_info`
- `probe_video_dimensions`
- `probe_video_display_dimensions`
- `probe_video_fps`

## `mediajob_type` Catalog

- `audio_master_v1`
- `video_master_v1`
- `create_video_export_v1`
- `upload_freeze_frame_v1`
- `upload_thumb_v1`
- `upload_edit_proxy_v1`
- `upload_audio_envelope_v1`
- `assemblyai_transcript_v1`
- `assemblyai_upload_transcript_v1`

## Practical query reminders

- Use exact tag filters in Jaeger: `key=value`.
- For Prometheus label-value lookup:
  - `/api/v1/label/app_operation/values`
  - `/api/v1/label/app_surface/values`
  - `/api/v1/label/app_outcome/values`
  - `/api/v1/label/error_class/values`
  - `/api/v1/label/mediajob_type/values`
