# Security

- Keep uploads bucket private; only presigned POST is allowed.
- Public outputs served only through CloudFront OAC.
- Cookie-based sessions: `/api/login` issues httpOnly `sid` + `csrf` cookie; `/api/me` exposes roles. Session records live in the `sessions` table.
- CSRF protection: all non-GET routes require `x-csrf-token` header matching the `csrf` cookie when a session exists.
- Admin token (x-admin-token) still bypasses sessions for automation (sign-upload/mark-complete) but should be treated like a secret.
- Limit upload size/type server- and client-side.
- IAM: least privilege on job role; EC2 role must only pass that role to MediaConvert.
- Consider signed CloudFront URLs for gated playback.
