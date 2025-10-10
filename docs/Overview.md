# Overview

This service enables direct browser uploads to S3 and one‑click publishing to AWS Elemental MediaConvert. It tracks uploads in MariaDB, writes HLS outputs to a public S3 bucket, and serves simple pages to upload, list, publish, and play videos.

Key features
- Direct S3 uploads (presigned POST) with size/type guardrails
- Upload tracking in `uploads` table (size, etag, dimensions, profile, job id)
- MediaConvert job profiles with composable JSON mixins and tokens
- CloudFront delivery for HLS manifests/segments
- Simple players: desktop (/videos) and edge‑to‑edge mobile (/mobile)
- Background poller to sync job status (queued → processing → completed)
- Request logs for each submitted job

Core buckets
- Uploads: private input, e.g., `bacs-mc-uploads`
- Public outputs: HLS delivery, e.g., `bacs-mc-public-stream` fronted by CloudFront

Path conventions
- Upload key: `uploads/YYYY-MM/DD/<uuid>/video.<ext>`
- Output prefix: `YYYY-MM/DD/<uuid>/<orientation>/`
- Master: `video.m3u8` (child playlists include resolution in name)

