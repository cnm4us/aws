# Plan 114F: Prompt Creative v2 (Dual Widgets + Media Background)

## Goal
Expand prompt creative controls so admins can produce and test richer prompts without changing feed layout mechanics:
- two configurable widgets per prompt,
- background image or video from existing assets,
- per-widget styling for contrast,
- consistent mobile playback behavior for prompt videos with optional audio.

This plan is intentionally scoped to preserve current prompt orchestration (`114A`-`114E`) and extend creative capabilities.

## Product Decisions (Locked)
- Keep prompt slide footprint identical to normal feed slides.
- Keep two widget types on each prompt:
  - `message_widget` (custom CTA copy + buttons)
  - `auth_widget` (`Register | Login | Dismiss`)
- Each widget can be independently:
  - enabled/disabled
  - positioned (`top | middle | bottom`)
  - offset with `y_offset_pct`
  - styled with `bg_color`, `bg_opacity`, `text_color`
- Prompt background can be:
  - `none` (gradient only)
  - `image` (from graphics assets)
  - `video` (from video assets)
- Prompt video playback uses the same user-gesture play pattern as normal slides (tap to play/unmute on mobile).

## Non-Goals (This Phase)
- Arbitrary drag-and-drop layout editor.
- Freeform HTML/CSS authoring.
- Auto-conflict resolution if widgets overlap.
- Prompt A/B engine redesign (existing priority/rotation stays as-is).

## UX Model
### Prompt Slide Composition
- Layer order:
  1. Background media (image/video/gradient)
  2. Overlay tint
  3. Widgets (`message_widget`, `auth_widget`)
- Widget placement is independent; overlap is allowed but editor shows warning.
- If both widgets are disabled, save is blocked.

### Video Interaction Model
- Prompt video uses the same play affordance and interaction semantics as regular video slides.
- CTA button taps must not trigger background play/pause.
- Video area tap toggles play/pause; first gesture allows audio per browser policy.

## Data Model Changes
Use additive schema to avoid breaking existing prompts.

### `prompts` table
- Add nullable `creative_json` (JSON/TEXT) for full creative config.
- Keep existing fields (`headline`, `body`, CTA fields, `media_upload_id`, `kind`) for compatibility and fallback.

### `creative_json` contract (v1)
```json
{
  "version": 1,
  "background": {
    "mode": "none|image|video",
    "uploadId": 123,
    "overlayColor": "#000000",
    "overlayOpacity": 0.35
  },
  "widgets": {
    "message": {
      "enabled": true,
      "position": "middle",
      "yOffsetPct": 0,
      "bgColor": "#0b1320",
      "bgOpacity": 0.55,
      "textColor": "#ffffff",
      "label": "Join the Community",
      "headline": "Welcome to BA",
      "body": "Fixed-field copy with limited formatting",
      "primaryLabel": "Register",
      "primaryHref": "/register?return=/",
      "secondaryLabel": "Login",
      "secondaryHref": "/login?return=/"
    },
    "auth": {
      "enabled": true,
      "position": "bottom",
      "yOffsetPct": 0,
      "bgColor": "#0b1320",
      "bgOpacity": 0.55,
      "textColor": "#ffffff"
    }
  }
}
```

### Validation rules
- `yOffsetPct`: `-40..40`
- `bgOpacity`: `0..1` (step `0.05`)
- Colors: hex only (`#RRGGBB`)
- Position enum strict.
- URL allowlist remains same as current CTA validation.
- Save fails if both widgets disabled.

## API Changes
### Admin prompt CRUD (`/api/admin/prompts`)
- Accept and return `creative_json` as structured `creative`.
- Server-side normalization fills defaults for missing fields.

### Feed prompt fetch (`/api/feed/prompts/:id`)
- Return resolved creative payload for renderer.
- If `creative_json` missing, build legacy fallback from existing prompt fields.

## Admin UI Plan (`/admin/prompts`)
Current UI is server-rendered; keep that architecture for speed and bundle safety.

### Editor sections
1. **Background**
   - Mode selector (`None`, `Image`, `Video`)
   - Asset picker integration:
     - image from `assets/graphics`
     - video from `assets/video`
   - Overlay color + opacity
2. **Message Widget**
   - Enabled toggle
   - Position + Y offset
   - BG color + opacity
   - Text color
   - Fixed copy fields (label/headline/body/CTA labels+links)
3. **Auth Widget**
   - Enabled toggle
   - Position + Y offset
   - BG color + opacity
   - Text color
   - Shell text/action stays standard
4. **Preview**
   - Mobile frame preview
   - Play button behavior shown when background video selected
   - Contrast warning + overlap warning

## Feed Renderer Changes (`frontend/src/app/Feed.tsx`)
- Add creative-aware prompt renderer:
  - reads `background` and `widgets`.
  - places each widget by position + offset.
- Background video path:
  - use same playback control semantics already used in slide videos.
  - maintain strict tap boundary handling (widget actions vs media playback).
- Preserve current prompt event tracking (`impression`, `click`, `dismiss`, `auth_start`, `auth_complete`).

## Observability and Analytics
Extend prompt event metadata:
- `app.prompt_creative_version`
- `app.prompt_bg_mode` (`none|image|video`)
- `app.prompt_widgets_enabled` (`message_only|auth_only|both`)
- `app.prompt_message_pos`, `app.prompt_auth_pos`

Analytics dimensions (bounded):
- `prompt_bg_mode`
- `prompt_widgets_enabled`
- optional `prompt_variant` later (not in this phase)

## Rollout Strategy
1. Add schema + backend support first (no UI changes).
2. Enable admin editing behind flag: `PROMPT_CREATIVE_V2_ENABLED`.
3. Render support with fallback to legacy prompt shape.
4. Migrate selected existing prompts to v2 config.
5. Remove flag after QA pass.

## Phases

### Phase A — Schema + Contract
- DB migration: add `creative_json`.
- Service-layer validation + normalization + fallback resolver.
- API serialization for admin + feed routes.

Acceptance:
- Existing prompts continue rendering unchanged.
- New prompts can persist and reload `creative_json`.

### Phase B — Admin Editor
- Add background mode and asset selection controls.
- Add both widget panels with style + position controls.
- Add preview block with overlap/contrast warnings.

Acceptance:
- Admin can create/edit/delete prompts with both widgets configured.
- Values survive refresh and appear in API responses.

### Phase C — Feed Rendering + Video Interaction
- Render both widgets according to config.
- Integrate prompt background video with normal slide play UX.
- Ensure CTA taps do not toggle video playback.

Acceptance:
- Prompt video with audio works via tap gesture.
- Widget positions are respected and independently configurable.

### Phase D — Analytics + Observability
- Add bounded creative tags to prompt events and spans.
- Add simple breakdowns in prompt analytics query by background mode and widget configuration.

Acceptance:
- Admin can compare conversion by creative mode (`image` vs `video`, etc.).

### Phase E — Hardening + Migration
- Migration utility: generate baseline `creative_json` from existing prompts.
- Add regression tests for fallback and validation edge cases.
- Document editor behavior and guardrails.

Acceptance:
- No legacy prompt regressions.
- Creative v2 stable on mobile Safari/Chrome.

## Test Plan
1. Create prompt with image background + both widgets.
2. Create prompt with video background + audio CTA flow.
3. Position widgets top/middle/bottom with offsets and verify in feed.
4. Ensure overlap warning appears but save allowed.
5. Verify CTA clicks, dismiss, and auth routing still tracked.
6. Verify legacy prompts (no `creative_json`) still render.

## Risks and Mitigations
- **Risk:** Widget overlap reduces readability.
  - **Mitigation:** Preview warning + safe defaults + contrast hints.
- **Risk:** Mobile audio behavior inconsistent.
  - **Mitigation:** User-gesture play model only; no forced autoplay-with-sound.
- **Risk:** Creative complexity hurts admin usability.
  - **Mitigation:** Fixed fields, defaults, and no freeform layout system in v2.

