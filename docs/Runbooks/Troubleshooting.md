# Troubleshooting

403 via CloudFront
- Check bucket policy with OAC AWS:SourceArn.
- Ensure OAC is attached and bucket public access is blocked.

400 BadRequest on CreateJob
- Check request log file; common issues:
  - LoudnessLogging must be LOG or DONT_LOG
  - CodecLevel AUTO when framerate/resolution varies

AccessDenied iam:PassRole
- Caller (EC2 role) missing iam:PassRole for MC_ROLE_ARN with condition iam:PassedToService=mediaconvert.amazonaws.com.

CORS errors in browser
- Attach a CloudFront response headers policy with Access-Control-Allow-Origin to your app origin.
