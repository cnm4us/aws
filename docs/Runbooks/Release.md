# Release

- npm ci
- Smoke test locally: upload → publish → play
- Commit and push
- CloudFront invalidation (if objects were deleted or renamed)
  aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
