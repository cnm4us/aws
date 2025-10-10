# MediaConvert

Roles
- Job Role (MC_ROLE_ARN): trusted by mediaconvert.amazonaws.com; grants S3 read (inputs) and write (outputs), and optional logs/KMS.
- EC2 Caller Role: must have iam:PassRole on the job role with condition iam:PassedToService=mediaconvert.amazonaws.com.

Queues
- Default queue is fine; set MC_QUEUE_ARN to target a specific queue later.

Acceleration
- ACCELERATION_MODE: PREFERRED (fallback), ENABLED (strict), or DISABLED.

Debugging
- Use request logs (logs/request/) to see final payload.
- `aws mediaconvert get-job --id <id> --endpoint-url <endpoint>` to view errors.

Common errors
- AccessDenied: missing iam:PassRole or cross-account role.
- BadRequest: codec level too low; set CodecLevel=AUTO; FramerateControl=INITIALIZE_FROM_SOURCE.
- OAC/S3 403 through CloudFront: fix bucket policy with AWS:SourceArn.

