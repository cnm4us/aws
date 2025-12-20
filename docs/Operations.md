# Operations

Health
- GET /health → { ok: true }

Status sync
- Background poller runs every STATUS_POLL_MS (default 30s) and updates DB.

Request logs
- logs/request/YYYY-MM-DD_hh:mm:ss.log — JSON payload for CreateJob.

Avatar storage
- User avatars are stored in the public OUTPUT_BUCKET (behind CloudFront) under a dedicated prefix, for example:
  - `profiles/avatars/{userId}/{yyyy-mm}/{uuid}.jpg`
  - Avatars are public identity assets, not part of identification/verification flows.
