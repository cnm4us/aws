# Plan 114D: Feed Inserter + Prompt Rendering

## Goal
Render prompt slides as first-class feed items without disrupting scroll flow.

## Scope
- Mixed feed item contract (`video`, `prompt_full`, `prompt_overlay`)
- Prompt insertion point logic
- Prompt slide rendering components
- Scroll/interaction behavior parity with video slides

Out of scope:
- Prompt/rule admin authoring
- Analytics dashboard UI

## Feed Contract
Unified item shape in feed response:
- `type: 'video' | 'prompt_full' | 'prompt_overlay'`
- `id`
- `position`
- `payload` (video or prompt data)

## Client Behavior
- Prompt slides occupy same viewport height as video slides.
- Prompt slides support:
  - primary/secondary CTA links,
  - dismiss/skip action,
  - consistent swipe/scroll transitions.
- Default CTA destinations for registration prompts:
  - primary `/register?return=/`
  - secondary `/login?return=/`
- Overlay prompt should not break underlying media rendering.

## Insertion Rules (V1)
- Insert prompts only through decision service output.
- Enforce distance between prompts in current feed batch.
- Keep ordering deterministic per session/page.

## Acceptance Criteria
1. Prompt slides appear naturally in feed flow.
2. Dismiss/skip works and influences future insertion decisions.
3. No layout regressions across mobile viewport sizes.
4. Prompt rendering does not degrade feed performance.

## Observability
- Emit client events on:
  - `prompt_impression`
  - `prompt_click`
  - `prompt_dismiss`
