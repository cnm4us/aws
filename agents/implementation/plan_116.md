# Plan 116: Automatic Image Derivatives for Prompt/Graphics/Logo Performance

## Goal
Reduce image payload size and improve reliability by automatically generating optimized image derivatives for:
- `/assets/graphic` uploads (prompt backgrounds + general graphics)
- `/assets/logo` uploads
- lower-third related image overlays (where upload-backed)

while preserving originals for future high-fidelity rendering/export.

## Problem Statement
Current flow can serve large originals (example: ~3.25 MB, 1536x2752) directly to feed/prompt surfaces. On mobile this causes:
- partial/late image paints
- inconsistent visual load behavior
- unnecessary bandwidth/cpu usage

## Product/Architecture Principles
1. Keep original assets immutable and available.
2. Serve derivatives for UI surfaces by default.
3. Use profile-based derivatives (not one fixed resolution).
4. Preserve alpha where needed (logos/lower-third overlays).
5. Provide explicit fallback path to original if derivative missing.
6. Make rollout reversible via feature flags.
7. Apply this to existing asset types (`assets/images`, `assets/logo`) without introducing a new “background asset” type.

## Key Decisions (from discussion)
- No separate background asset type: prompt backgrounds are sourced from `assets/images`.
- Primary downsizing point: **on upload completion** (async media job).
- Secondary path: **at time-of-use fallback** only when derivative is missing (serve original and/or queue generation).
- Keep env-tunable quality/format by profile class (prompt bg / logo / lower-third), not a single global quality value.

---

## Scope
### In scope
- Derivative generation jobs for image-like uploads
- Storage/indexing of derivative metadata
- Backend selection/signing of best variant per usage surface
- Frontend use of variants for prompt/feed/admin previews
- Backfill for existing assets

### Out of scope (for this plan)
- Re-encoding video assets
- Replacing final export mastering behavior (can continue using original unless explicitly opted in)
- Complex AI upscaling/cropping UI

---

## Asset Classes and Variant Profiles

## 1) Graphic / Prompt Background (opaque or mostly opaque)
Usage: full-frame/background visuals in feed and prompt slides.

Recommended profiles:
- `prompt_bg_p_1x_webp`: 720x1280, `fit: cover`, q=78
- `prompt_bg_p_2x_webp`: 1080x1920, `fit: cover`, q=80
- `prompt_bg_l_1x_webp`: 1280x720, `fit: cover`, q=78
- `prompt_bg_l_2x_webp`: 1920x1080, `fit: cover`, q=80

## 2) Logo (needs transparency)
Usage: overlay/logo lanes.

Recommended profiles:
- `logo_512_webp_alpha`: long-edge 512, preserve alpha
- `logo_1024_webp_alpha`: long-edge 1024, preserve alpha
- Optional fallback png for compatibility edge-cases:
  - `logo_512_png_alpha`

## 3) Lower-third image overlays (if upload-backed image)
Usage: alpha overlays where crisp text edges matter.

Recommended profiles:
- `lt_1280_webp_alpha`: width 1280, preserve alpha
- `lt_1920_webp_alpha`: width 1920, preserve alpha
- Optional png fallback for QA comparison:
  - `lt_1920_png_alpha`

Notes:
- If a source is smaller than target, do not upscale by default (`withoutEnlargement=true`).
- Keep profile definitions centralized in config for future tuning.

---

## Data Model Changes
Add derivative metadata table (suggested):
- `upload_image_variants`
  - `id`
  - `upload_id` (fk uploads.id)
  - `profile_key` (indexed)
  - `format` (`webp|png|jpeg|avif`)
  - `width`, `height`
  - `bytes`
  - `s3_bucket`, `s3_key`
  - `etag` (optional)
  - `status` (`ready|failed`)
  - `error_code` (nullable)
  - timestamps

Constraints/indexes:
- unique (`upload_id`, `profile_key`)
- index (`profile_key`, `status`)

Rationale:
- Allows fast variant lookup and deterministic serving.

---

## Processing Pipeline

## Phase A — Profile Registry + Schema
1. Define profile registry in server config (`imageVariantProfiles`).
2. Add DB migration for `upload_image_variants`.
3. Add repo/service layer methods:
   - upsert variant
   - list variants by upload
   - fetch best variant for usage

Deliverable: profile contract + persistence ready.

## Phase B — Derivative Job Worker
1. Add media job type: `upload_image_derivatives_v1`.
2. Trigger job on upload completion for `kind=image` and `kind=logo`.
3. Implement generator using image library (recommended: `sharp`):
   - read source from S3
   - produce configured profiles
   - upload outputs to S3 (uploads bucket derived prefix)
   - upsert metadata rows
4. Handle failures per-profile without failing all outputs.

Suggested key pattern:
- `derived/uploads/{uploadId}/{profileKey}.{ext}`

Deliverable: new uploads automatically produce optimized variants.

## Phase C — Selection + Signing API
1. Add selection helper:
   - input: `uploadId`, `usage`, `orientation`, `dpr`
   - output: best available variant metadata/url
2. Add signing support for variant keys (same CloudFront signing strategy).
3. Extend relevant payload surfaces:
   - `/api/feed/prompts/:id` -> return prompt background variant urls (1x/2x)
   - admin prompt preview data path -> use variant url (not original)
4. Keep fallback to original if no variant exists.

Deliverable: client receives right-sized signed URLs.

## Phase D — Frontend Consumption
1. `/create-video` and feed/prompt surfaces:
   - use returned variant urls
   - choose 1x/2x by `window.devicePixelRatio`
2. `/admin/prompts` preview:
   - load variant matching preview device frame
3. `/assets` lists/cards:
   - prefer thumbs/variants consistently
4. Keep graceful fallback path if variant request fails.

Deliverable: visible reduction in payload size and improved load consistency.

## Phase E — Backfill Existing Library
1. Add admin/ops command:
   - enqueue derivative jobs for historical image/logo/lower-third assets.
2. Run in batches (rate-limited) to avoid worker starvation.
3. Track progress in media jobs UI and logs.

Deliverable: old assets gain derivatives without manual re-upload.

## Phase F — Observability + Guardrails
1. Logs:
   - generation start/finish/fail with `upload_id`, `profile_key`, `bytes`.
2. Traces:
   - `app.operation=uploads.image_variant.generate`
   - `app.operation=uploads.image_variant.select`
3. Prometheus metrics:
   - variant generation success/failure rate
   - avg generation latency
   - payload reduction ratio (`original_bytes / selected_variant_bytes`)
4. Alerts:
   - sustained generation failure rate
   - variant lookup fallback rate spikes

Deliverable: measurable reliability + savings.

---

## Rollout Strategy
Feature flags:
- `IMAGE_VARIANTS_ENABLED=1`
- `IMAGE_VARIANTS_PROMPT_ENABLED=1`
- `IMAGE_VARIANTS_ASSETS_ENABLED=1`
- `IMAGE_VARIANTS_REQUIRE_READY=0` (if 1, strict behavior; default 0 with fallback)

Env tuning knobs (examples):
- `IMAGE_VARIANTS_FORMAT=webp`
- `IMAGE_VARIANTS_QUALITY_PROMPT_BG=80`
- `IMAGE_VARIANTS_QUALITY_LOGO=82`
- `IMAGE_VARIANTS_QUALITY_LOWER_THIRD=84`
- `IMAGE_VARIANTS_WITHOUT_ENLARGEMENT=1`

Rollout steps:
1. Deploy schema + worker + metadata writes (selection off).
2. Enable selection for admin preview only.
3. Enable selection for prompt/feed backgrounds.
4. Enable selection across assets UI.
5. Run backfill.

Rollback:
- Disable selection flags; keep originals serving immediately.

---

## Acceptance Criteria
1. Prompt/feed background images no longer serve full-size originals by default.
2. Median image payload on prompt/feed drops substantially (target: >60% reduction).
3. No visual regression in alpha assets (logos/lower-third overlays).
4. Missing-variant fallback works (no broken images).
5. Existing library assets can be backfilled without downtime.
6. Metrics/logs expose generation health and fallback rates.

---

## Risks and Mitigations
- Risk: quality degradation from over-compression.
  - Mitigation: profile QA set + tunable quality values.
- Risk: alpha edge artifacts for logos/lower-thirds.
  - Mitigation: keep alpha-aware profiles and optional PNG fallback.
- Risk: extra CPU for variant generation.
  - Mitigation: async media jobs, queue throttling, batch backfill windows.
- Risk: profile explosion/complexity.
  - Mitigation: start with minimal profile set, expand only on evidence.

---

## Follow-on (Plan 116A candidates)
- AVIF variants for modern browsers with WebP fallback.
- Client Hints integration (`DPR`, `Viewport-Width`) for finer selection.
- Automatic smart-crop focal point support.
- Export pipeline option to consume derivatives for non-master outputs.
