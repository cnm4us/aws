# Plan 137: Modular CTA Widget for Messages

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Message UI currently mixes content and CTA responsibilities across `message` and `auth` widgets.
  - We need a modular CTA system that supports multiple workflows (`auth`, `donate`, `subscribe`, `upgrade`) without coupling to content presentation.
- In scope:
  - Content-only `message` widget.
  - New `cta` widget with `type` + per-type config blocks.
  - Admin UI updates for type-driven CTA configuration.
  - Runtime rendering + click flow plumbing for CTA types.
  - Completion event + suppression wiring (campaign scope).
- Out of scope:
  - Production PayPal implementation (can use mock completion route first).
  - New pricing/billing backend beyond CTA completion contract.
- Constraints:
  - Backward compatibility with existing message records.
  - Keep feed rendering stable while migrating widget schema.
  - Preserve observability/debug visibility.

## Locked Decisions
- `widgets.message` becomes content-only (title/text/style/position, no buttons).
- `widgets.cta` is the single CTA system with `type`:
  - `auth`, `donate`, `subscribe`, `upgrade`
- Suppression on completion uses campaign scope by default.
- Completion attribution continues to use `intent_id`.
- Mock completion routes are acceptable for non-auth CTA types until provider integrations are ready.

## Phase Status
- A: Completed
- B: Completed
- C: Pending
- D: Pending
- E: Pending
- F: Pending

## Phase A — Contract + Migration Layer
- Goal:
  - Introduce stable data contract for `creative.widgets.cta` and make old records load safely.
- Steps:
  - [x] Define normalized CTA contract in message service/types.
  - [x] Add compatibility mapper:
    - old `auth` widget + button fields -> new `cta` widget
    - keep read-time fallback for legacy records.
  - [x] Ensure save path emits new contract shape.
- Test gate:
  - `npm run -s build`
- Acceptance:
  - old records render; new saves persist `widgets.cta` shape.

## Phase B — Admin UI: Message/CTA Split
- Goal:
  - Update admin message editor UX to reflect separation of concerns.
- Steps:
  - [ ] `Message Widget Content` section:
    - title, text, style/position controls only.
  - [ ] New `CTA Widget` section:
    - enabled, style/position/layout
    - `CTA Type` select (`auth|donate|subscribe|upgrade`)
    - type-specific config form blocks.
  - [ ] Live preview updates:
    - message widget text block
    - CTA widget buttons/labels by type.
- Test gate:
  - admin create/edit/save flows for each CTA type.
- Acceptance:
  - no duplicate auth-button config surfaces; preview matches saved config.

## Phase C — Feed Runtime Rendering
- Goal:
  - Render CTA widget by type with independent positioning from message widget.
- Steps:
  - [ ] Feed renderer consumes `widgets.cta` normalized model.
  - [ ] Preserve independent `position` + `yOffsetPct` for both widgets.
  - [ ] Keep existing style controls (bg/text/opacity/layout) where applicable.
  - [ ] Maintain graceful fallback when CTA disabled or config invalid.
- Test gate:
  - visual smoke on mobile/desktop for top/bottom combinations.
- Acceptance:
  - message and CTA widgets place independently and render consistently.

## Phase D — CTA Flow Plumbing + Completion Contract
- Goal:
  - Standardize click/start/complete event pipeline across CTA types.
- Steps:
  - [ ] Extend `message_flow` values to include:
    - `donate`, `subscribe`, `upgrade` (in addition to auth login/register subflow).
  - [ ] Continue issuing `intent_id` on CTA click for all types.
  - [ ] Add mock completion endpoints for non-auth types:
    - e.g. `/api/cta/mock/complete`
  - [ ] Emit completion event names by type:
    - `auth_complete_from_message`
    - `donation_complete_from_message`
    - `subscription_complete_from_message`
    - `upgrade_complete_from_message`
- Test gate:
  - click -> intent -> complete path for each CTA type (mock for non-auth).
- Acceptance:
  - end-to-end completion attribution works uniformly by CTA type.

## Phase E — Suppression + Decision Engine Integration
- Goal:
  - Enforce completion-based suppression in decision engine using campaign scope.
- Steps:
  - [ ] Decision path checks `feed_message_user_suppressions` for authenticated users before selection.
  - [ ] Apply suppression for all CTA completion types, not auth-only.
  - [ ] Keep anonymous/session suppression behavior unchanged.
  - [ ] Add trace/log tags for suppression reason + scope.
- Test gate:
  - complete CTA for campaign X, confirm no X messages for logged-in user.
- Acceptance:
  - suppression behavior consistent and observable.

## Phase F — Analytics + Observability + Docs
- Goal:
  - Ensure reporting/debugging reflects modular CTA model.
- Steps:
  - [ ] Expand analytics enums/rollups for new completion event types.
  - [ ] Add CTA type/flow facets in analytics UI (where relevant).
  - [ ] Update debug bundle interpretation:
    - CTA type-specific click/start/complete summaries.
  - [ ] Update docs:
    - widget contract
    - test recipes
    - mock-vs-provider completion strategy.
- Test gate:
  - run bundle on mixed CTA test and verify summaries align with observed behavior.
- Acceptance:
  - clear analytics/debug traces for each CTA type.

## Change Log
- (uncommitted) — Phase A contract + mapper:
  - `src/features/messages/types.ts` adds `widgets.cta` contract (`type`, `layout`, per-type config blocks)
  - `src/features/messages/service.ts` normalization now:
    - reads legacy `message.primary*` / `auth` and maps to `widgets.cta`
    - saves normalized `widgets.cta` shape
    - keeps legacy `widgets.auth` compatibility for current runtime/UI
- (uncommitted) — Phase B admin editor split:
  - `src/routes/pages.ts`
    - Message section now content-only (title/text/style/position)
    - New CTA Widget section with type/layout/style/position + per-type config blocks
    - Preview split into content widget + CTA widget
    - Save payload writes `creative.widgets.cta` and mirrors legacy top-level CTA/auth fields for compatibility

## Validation
- Environment:
  - local dev + Jaeger + otelcol + serve:jaeger:log
- Commands run:
  - `npm run -s build`
- Evidence files:
  - `tests/runs/api-curl/*` (to be added during implementation)
- Known gaps:
  - PayPal provider details intentionally deferred behind mock completion contract.

## Open Risks / Deferred
- Risk:
  - Enum expansion for new completion event names affects analytics rollups and dashboards.
- Risk:
  - Legacy creative payloads may have partial/malformed widget data.
- Deferred:
  - Real provider adapters (PayPal, Stripe, etc.).

## Resume Here
- Next action:
  - Start Phase A and add normalized CTA widget contract + legacy mapper.
- Blocking question (if any):
  - none
