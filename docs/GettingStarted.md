# Getting Started

Prerequisites
- Node.js 18+
- MariaDB reachable on 127.0.0.1 (see .env)
- AWS access on EC2 (instance profile recommended)

Setup
1) Copy env and edit values
   cp .env.example .env
   # set AWS_REGION, DB_*, UPLOAD_BUCKET, OUTPUT_BUCKET, CLOUDFRONT_DOMAIN

2) Install deps
   npm install

3) Start the server
   npm run serve

4) Configure S3 CORS for uploads (dev)
   aws s3api put-bucket-cors --bucket <UPLOAD_BUCKET> --cors-configuration file://s3-cors.json

5) CloudFront for outputs
- Create a distribution with OAC for your output bucket.
- Add behaviors: *.m3u8 (short TTL), *.ts/*.m4s (long TTL), attach CORS policy.

First run
- Upload: open / (upload.html), select a video, upload
- Publish: open /publish.html, pick a profile/quality/sound, click Publish
- Play: open /videos?id=<upload_id> or /mobile?id=<upload_id>

Troubleshooting
- Check logs/request for the final MediaConvert payload submitted.
- Use `aws mediaconvert get-job --id <id> --endpoint-url <account endpoint>` to inspect job errors.

