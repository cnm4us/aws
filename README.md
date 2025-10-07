**Overview**
- Node.js + TypeScript workspace to submit AWS Elemental MediaConvert jobs.
- Includes helpers to discover account-specific MediaConvert endpoint and simple CLI tools.

**Prerequisites**
- Node.js and npm installed on EC2.
- AWS access on EC2 via one of:
  - Instance profile with permissions to call MediaConvert APIs, or
  - AWS CLI profile/keys configured in `~/.aws` or environment variables, or
  - SSO via `aws configure sso` (then export `AWS_PROFILE`).
- S3 buckets for inputs and outputs.

**Install**
- Copy `.env.example` to `.env` (optional). Ensure `AWS_REGION` is set (or export in shell).
- Install deps: `npm install`

**AWS/IAM Setup**
- EC2 instance permissions (to submit jobs):
  - Attach/associate an instance profile with policy allowing MediaConvert actions like `mediaconvert:DescribeEndpoints`, `mediaconvert:CreateJob`, and `mediaconvert:GetJob`.
  - Minimum example policy (adjust region and resource scoping as desired):

    {
      "Version": "2012-10-17",
      "Statement": [
        { "Effect": "Allow", "Action": [
            "mediaconvert:DescribeEndpoints",
            "mediaconvert:CreateJob",
            "mediaconvert:GetJob",
            "mediaconvert:ListJobs"
        ], "Resource": "*" }
      ]
    }

- MediaConvert job role (assumed by the MediaConvert service while processing your media):
  - Create an IAM role with trust policy for `mediaconvert.amazonaws.com`.
  - Grant it S3 read on your input bucket and S3 write on your output bucket, and optional CloudWatch Logs.
  - Example trust policy:

    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": { "Service": "mediaconvert.amazonaws.com" },
          "Action": "sts:AssumeRole"
        }
      ]
    }

  - Example permissions (tighten as needed):

    {
      "Version": "2012-10-17",
      "Statement": [
        { "Effect": "Allow", "Action": [
            "s3:GetObject",
            "s3:ListBucket"
        ], "Resource": [
            "arn:aws:s3:::YOUR_INPUT_BUCKET",
            "arn:aws:s3:::YOUR_INPUT_BUCKET/*"
        ]},
        { "Effect": "Allow", "Action": [
            "s3:PutObject",
            "s3:AbortMultipartUpload",
            "s3:ListBucketMultipartUploads"
        ], "Resource": [
            "arn:aws:s3:::YOUR_OUTPUT_BUCKET",
            "arn:aws:s3:::YOUR_OUTPUT_BUCKET/*"
        ]}
      ]
    }

  - Note: This job role ARN is what you pass via `--role` when creating a job.

**Verify AWS connectivity**
- Optional CLI checks:
  - `aws --version`
  - `aws sts get-caller-identity`
  - `aws mediaconvert describe-endpoints --region $AWS_REGION`

**Scripts**
- Discover endpoint and cache to `.mc-endpoint.json`:
  - `AWS_REGION=us-east-1 npm run mc:describe`

- Create a simple H.264/AAC MP4 job:
  - `AWS_REGION=us-east-1 npm run mc:create -- \
     --input s3://your-input-bucket/path/in.mp4 \
     --output s3://your-output-bucket/path/out-prefix/ \
     --role arn:aws:iam::123456789012:role/MediaConvert_Default_Role`

Notes
- You can set `MEDIACONVERT_ENDPOINT` in `.env` to skip discovery.
- The endpoint is cached per-region in `.mc-endpoint.json` after first discovery.
- The provided job settings are minimal; we’ll extend to PIP, overlays, and advanced audio later.

