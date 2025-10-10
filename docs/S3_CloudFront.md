# S3 and CloudFront

Uploads bucket (private)
- Name: e.g., bacs-mc-uploads
- CORS: allow POST for direct browser uploads; restrict origins in prod.

Public outputs bucket
- Name: e.g., bacs-mc-public-stream
- Access: via CloudFront OAC only (block public access ON)

CloudFront
- Alternate domain: videos.<domain>
- OAC: attach to the S3 origin
- Response headers policy: add CORS for your app origin
- Behaviors:
  - *.m3u8 — GET/HEAD/OPTIONS, short TTL, compression ON
  - *.ts/*.m4s — GET/HEAD/OPTIONS, long TTL, compression OFF
  - Default — conservative

Bucket policy for OAC
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAC",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<OUTPUT_BUCKET>/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
        }
      }
    }
  ]
}

