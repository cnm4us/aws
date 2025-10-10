# Jobs and Profiles

Composable structure
- profiles/: small files that declare `$extends` with mixins
- mixins/: reusable fragments for output layout, quality, audio
- templates/: base parts (inputs, timecode)

Tokens
- INPUT_URI → s3://<input bucket>/<key>
- OUTPUT_BUCKET → replaced with configured output bucket
- ASSET_ID → upload UUID (directory)
- DATE_YYYY_MM_DD → resolved to YYYY-MM/DD for paths

Merging rules
- Objects: deep merge (later overrides earlier)
- Arrays: matched by stable keys
  - OutputGroups → Name
  - Outputs → NameModifier
  - AudioDescriptions → AudioSourceName
  - Otherwise: replace array

Naming
- Single master manifest: video.m3u8 (AdditionalManifests removed)
- Child playlists include resolution in NameModifier (e.g., 1080p, 720p)

Adding a profile
1) Create jobs/profiles/my-profile.json
{
  "$extends": [
    "templates/base-hls",
    "mixins/output/portrait-1080-720-540",
    "mixins/quality/h264-qvbr-hq",
    "mixins/audio/normalize-lufs-16"
  ]
}
2) Publish with profile="my-profile" or pick it in /publish.html

