HLS jobs: templates, usage, and layout

What is a mezzanine?
- In media workflows, a mezzanine is a high-quality master used for (re)transcoding. If you want to preserve the exact file users uploaded, copy that original to `bacs-mc-transcoded/{assetId}/original.ext` (script included).

Buckets and layout (recommended)
- Uploads (private): `s3://bacs-mc-uploads/{assetId}/...`
- Streaming (private behind CloudFront OAC): `s3://bacs-mc-public-stream/{assetId}/{orientation}/{rendition}/...`
- Optional archive (originals): `s3://bacs-mc-transcoded/{assetId}/original.ext`

Templates
- `job-portrait-hls.json` — portrait HLS ladder (1080p/720p/540p)
- `job-landscape-both-hls.json` — both portrait-from-landscape (720p/540p) and landscape ladder (1080p/720p/480p)

Both templates:
- Use per-stream subfolders (`DirectoryStructure: SUBDIRECTORY_PER_STREAM`)
- Emit a `master.m3u8` per orientation via `AdditionalManifests`
- Honor camera rotation (`VideoSelector.Rotate: AUTO`)

Submit a job
1) Choose an asset id and input uri
   - `ASSET_ID=my-video-001`
   - `INPUT_URI=s3://bacs-mc-uploads/path/file.mp4`
2) Submit:
   - Portrait source:
     - `scripts/submit_hls_job.sh portrait "$ASSET_ID" "$INPUT_URI"`
   - Landscape source:
     - `scripts/submit_hls_job.sh landscape "$ASSET_ID" "$INPUT_URI"`
3) Monitor:
   - `aws mediaconvert get-job --region us-west-1 --endpoint-url https://mediaconvert.us-west-1.amazonaws.com --id <JOB_ID> --query 'Job.Status' --output text`

Archive the original (optional)
- `scripts/archive_original.sh s3://bacs-mc-uploads/path/file.mp4 $ASSET_ID`
- This copies to `s3://bacs-mc-transcoded/$ASSET_ID/original.mp4` (keeps the original extension).

Resulting paths (example)
- Portrait:
  - `s3://bacs-mc-public-stream/{assetId}/portrait/master.m3u8`
  - `s3://bacs-mc-public-stream/{assetId}/portrait/1080p/index.m3u8` + segments
- Landscape:
  - `s3://bacs-mc-public-stream/{assetId}/landscape/master.m3u8`
  - `s3://bacs-mc-public-stream/{assetId}/landscape/720p/index.m3u8` + segments

Notes
- If your streaming bucket enforces SSE-KMS, add DestinationSettings.Encryption to the HLS groups.
- To produce a downloadable MP4 alongside HLS, add a File Group output writing to `bacs-mc-transcoded/{assetId}/`.

