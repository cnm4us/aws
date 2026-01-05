High-Level Overview: Media Processing API (FFmpeg-Backed)
Purpose & Scope

We are building a media processing API whose initial goal is to provide basic, reliable audio processing (normalization, mixing, ducking, etc.) using FFmpeg, with a simple queue to control execution and protect system resources.

The system must be:

Fast to ship for audio-only workflows

Structurally prepared for video processing

Easily portable from the current EC2 instance to a dedicated FFmpeg worker EC2 later

Queue-driven and stateless

Designed with observability and debuggability in mind from the beginning

Extendable later with analytics, metrics, and cost modeling

This API is internal, not public-facing, and is intended to be a reusable subsystem.

Core Design Principles
1. Separation of Intent vs Execution

API callers express what they want done, not FFmpeg flags.

FFmpeg usage is an implementation detail, not part of the API contract.

Processing is described using presets / profiles, not raw commands.

2. Queue-First Architecture

All media work runs asynchronous via a queue.

The queue protects CPU, disk, and memory.

Queue depth and job state become first-class system concepts.

3. Stateless Workers

Workers assume:

Inputs come from object storage (e.g., S3)

Outputs are written back to object storage

Local disk is scratch only

No job state is stored on disk between runs.

4. Incremental Capability Growth

Start with audio-only features

Expand into video features without redesign

Expand into LUTs, subtitles, etc. later

Expand into analytics and cost attribution later

Initial Functional Scope (Phase 1: Audio)
Audio Capabilities (Initial)

Audio extraction from video

Audio normalization (LUFS / loudness)

Simple mixing (voice + music)

Optional ducking (sidechain compression)

Format conversion (e.g., WAV → AAC)

Channel normalization (mono/stereo)

All audio features should be implemented using:

Declarative Audio Presets

Versioned and testable configurations

No video processing is required initially, but the system must assume video will be added later.

API Shape (Conceptual)
Job Submission

The API accepts a media job request

The request references:

Input asset(s)

Desired audio preset

Desired output profile

The API enqueues a job and returns a job ID

Example (conceptual, not final schema):

{
  "inputAssetId": "s3://bucket/original.mp4",
  "audioProfile": "dialogue_clean_v1",
  "outputProfile": "audio_only_master_v1"
}

Job Lifecycle

Jobs move through explicit states:

PENDING

PROCESSING

COMPLETED

FAILED (retryable)

DEAD (manual inspection)

State transitions should be observable and logged.

Queue Design (Phase 1)
Requirements

Simple, reliable queue (Redis-based or equivalent)

One job processed per worker at first

Concurrency limits enforced centrally

Retry + backoff supported

Responsibilities

Decouple API requests from FFmpeg execution

Enable future autoscaling

Enable later job prioritization

Worker Responsibilities

Each worker:

Pulls one job from the queue

Creates a local scratch workspace

Downloads required input assets

Runs FFmpeg using compiled presets

Uploads outputs

Emits logs, metrics, and job results

Cleans up scratch space

Workers must not:

Serve HTTP traffic

Store persistent state

Assume local disk durability

Local Scratch Space

Use local disk (EBS now; instance store later)

Scratch is ephemeral and job-scoped

All paths managed via a workspace abstraction

Disk cleanup is mandatory on success or failure

Portability Requirement

The system must be written so that:

API and worker can run on the same EC2 initially

Worker can later move to:

A dedicated EC2 instance

Multiple EC2 instances

Autoscaled worker groups

This implies:

No hard-coded local paths

No reliance on localhost semantics

Clear boundaries between API, queue, and worker logic

Debugging & Observability (Early Consideration)
Required Early Debug Features

Capture FFmpeg stdout/stderr per job

Store logs with job ID correlation

Preserve failed-job artifacts temporarily

Enable re-running jobs deterministically

Debug Modes

“Verbose” job mode for development

Ability to replay a job with identical inputs

Optional debug overlays or markers later (video phase)

Analytics & Metrics (Deferred but Planned)

Not required for initial launch, but the design should allow:

Job duration tracking

CPU time approximation

Per-preset performance stats

Queue wait time metrics

Failure rate tracking

Metrics should be additive, not retrofitted.

Planned Expansion Areas (Not Implemented Initially)

The following should be architecturally anticipated, but not built yet:

Video conditioning (scale, crop, denoise)

LUT application

Masking (static and animated)

Subtitle burn-in and muxing

STT integration (Whisper API now, self-hosted later)

Multi-output jobs

Cost-based job classification

Non-Goals (Important)

This is not a public API

This is not a full transcoding replacement for MediaConvert

This system prepares canonical masters, not ABR ladders

DRM, packaging, and CDN delivery are out of scope

Summary (For Codex)

This system should be designed as:

A media mastering service

Queue-driven

FFmpeg-backed

Audio-first

Video-ready

Portable by default

Observable from day one

Initial success is defined by:

Fast delivery of reliable audio processing

Clean abstractions

Zero throwaway work when scaling later