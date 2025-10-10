# Configuration

Environment variables (with defaults)
- PORT (3300) — HTTP server port
- AWS_REGION — AWS region (required unless instance profile default)
- UPLOAD_BUCKET — private input bucket
- UPLOAD_PREFIX (uploads/)
- MAX_UPLOAD_MB (200)
- OUTPUT_BUCKET — public HLS bucket (behind CloudFront)
- OUTPUT_PREFIX (hls/)
- CLOUDFRONT_DOMAIN — e.g., videos.example.com (optional; used to build cdn_master)
- MC_ROLE_ARN — IAM role assumed by MediaConvert jobs (required to publish)
- MC_QUEUE_ARN — optional MediaConvert queue
- ACCELERATION_MODE (PREFERRED) — DISABLED | ENABLED | PREFERRED
- MC_PRIORITY (0) — -50..50
- STATUS_POLL_MS (30000) — status sync cadence
- REQUEST_LOGS_DIR (logs/request)

Database (.env)
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

Notes
- dotenv is loaded at startup. Values in the environment override .env.
- For CloudFront, ACM certificates must be in us-east-1.

