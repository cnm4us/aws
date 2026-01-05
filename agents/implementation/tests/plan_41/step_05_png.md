Step 05 (SVG→PNG)

- Added server-side rasterization via `@resvg/resvg-js` in `src/services/lowerThirdPng.ts`.
- Production runner generates a transparent PNG and uploads it to `s3://${UPLOAD_BUCKET}/lower-thirds/.../lower_third.png`.

