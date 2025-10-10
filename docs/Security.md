# Security

- Keep uploads bucket private; only presigned POST is allowed.
- Public outputs served only through CloudFront OAC.
- Add simple auth to /api/publish in production (admin token or session).
- Limit upload size/type server- and client-side.
- IAM: least privilege on job role; EC2 role must only pass that role to MediaConvert.
- Consider signed CloudFront URLs for gated playback.

