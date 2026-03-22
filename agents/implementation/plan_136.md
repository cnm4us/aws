# Plan 136: Message CTA Completion Attribution (Login/Register)

Status: Active

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - We currently track message impressions/pass-throughs and CTA clicks, but we do not have a durable, reliable attribution path from message CTA click to auth completion (`login`/`register`).
  - We want completion-based suppression (not click-based suppression).
- In scope:
  - Intent-based attribution for auth completions.
  - Durable suppression written only on completion.
  - Analytics event model updates for `cta_click`, optional `auth_start`, and `auth_complete`.
  - Decision service suppression check updates.
  - Test coverage for idempotency and expiration.
- Out of scope:
  - New UI flows for auth.
  - Multi-device anonymous identity stitching beyond intent token handoff.
  - Non-auth completion pipelines.
- Constraints:
  - Preserve existing message feed behavior.
  - Keep analytics backward-compatible where practical.
  - Idempotent completion ingestion.

## Locked Decisions
- Suppression trigger is `auth_complete` only (not CTA click).
- Anonymous users get session/local suppression only until auth completes.
- Attribution key is `intent_id` UUID carried through auth state.
- Completion ingestion must be idempotent and safe under retries.
- Intent records have TTL (default 30 minutes).

## Phase Status
- A: Completed
- B: Completed
- C: Completed
- D: Pending
- E: Pending

## Phase A — Schema + Migration
- Goal:
  - Add durable storage for attribution intents and completion suppression.
- Steps:
  - [x] Add migration for `feed_message_auth_intents`.
  - [x] Add migration for `feed_message_user_suppressions`.
  - [x] Add supporting indexes and uniqueness constraints:
    - `feed_message_auth_intents(intent_id PK, expires_at, state, created_at)`
    - `feed_message_user_suppressions` unique by:
      - `(user_id, suppression_key)` (where key is `m:<message_id>` or `c:<campaign_key>`)
  - [x] Ensure existing `feed_message_events` can store `intent_id` and event names (`cta_click`, `auth_start`, `auth_complete`) either via existing JSON/meta or added nullable column.
- Test gate:
  - run migrations up/down in dev.
  - verify schema and indexes via DB introspection.
- Acceptance:
  - tables/constraints exist and migration is reversible.

## Phase B — Server Domain + Repos
- Goal:
  - Implement typed repo/service layer for intent lifecycle and suppression writes.
- Steps:
  - [x] Add intent repository:
    - create intent
    - mark started (optional)
    - consume/complete (single-use)
    - expire lookup handling
  - [x] Add suppression repository:
    - upsert suppression by user + scope/message/campaign.
    - read suppression for decision checks.
  - [x] Add server-side validation helpers:
    - valid flow (`login|register`)
    - valid intent UUID format
    - intent TTL checks
- Test gate:
  - `npm run -s build`
- Acceptance:
  - deterministic lifecycle behavior and idempotent completion semantics.

## Phase C — API + Auth Touchpoints
- Goal:
  - Wire intent issuance at CTA click and completion at auth success.
- Steps:
  - [x] On message CTA click path:
    - generate/store `intent_id`
    - emit `feed.message.event` (`cta_click`) with message/session/sequence context
    - attach `intent_id` to auth redirect state/return payload
  - [x] Optional `auth_start` event at redirect initiation.
  - [x] On auth success callback/controller:
    - read `intent_id`
    - resolve/validate unconsumed, unexpired intent
    - emit `auth_complete` event with attribution fields
    - upsert suppression row for resolved `user_id`
    - mark intent consumed
  - [x] Handle duplicate callback safely (no duplicate completion writes).
- Test gate:
  - `npm run -s build`
- Acceptance:
  - full click→completion attribution works end-to-end.

## Phase D — Decision Engine Suppression
- Goal:
  - Enforce completion-based suppression in feed decision.
- Steps:
  - [ ] Update message decision service to check durable suppression first for authenticated users.
  - [ ] Keep current anonymous/session suppression behavior unchanged.
  - [ ] Add telemetry tags on suppression path:
    - `app.message_suppressed=true`
    - `app.message_suppression_reason=auth_complete`
    - scope metadata (`message|campaign`)
- Test gate:
  - authenticated user with suppression no longer receives message.
  - anonymous user behavior unchanged.
- Acceptance:
  - suppression behavior matches policy with traceable tags/logs.

## Phase E — Analytics + Observability + QA
- Goal:
  - Expose funnel and verify with debug bundle + Jaeger.
- Steps:
  - [ ] Ensure events are queryable in analytics:
    - `impression`, `cta_click`, `auth_start` (if enabled), `auth_complete`, `pass_through`
  - [ ] Add/verify Jaeger `app.operation_detail` coverage for each new event.
  - [ ] Update debug docs and test cookbook:
    - exact commands
    - expected counts and interpretation
  - [ ] Add regression tests for:
    - stale/expired intent
    - completion without intent
    - completion with mismatched user/session context (safe fail)
- Test gate:
  - run smoke flow with one successful completion and verify:
    - one `auth_complete`
    - suppression row exists
    - subsequent decision suppresses message
- Acceptance:
  - funnel visible; suppression validated; no duplicate completions.

## Change Log
- (uncommitted) — Phase A schema bootstrap updates in `src/db.ts` for:
  - `feed_message_auth_intents`
  - `feed_message_user_suppressions`
  - `feed_message_events` attribution columns (`intent_id`, `flow`, `message_sequence_key`)
- (uncommitted) — Phase B new attribution domain:
  - `src/features/message-attribution/types.ts`
  - `src/features/message-attribution/repo.ts`
  - `src/features/message-attribution/service.ts`
  - config: `MESSAGE_AUTH_INTENT_TTL_MINUTES`
- (uncommitted) — Phase C auth touchpoint wiring:
  - New route `POST /api/feed/message-auth-intent` in `src/routes/feed-messages.ts`
  - Message event ingest now accepts `message_flow`, `message_intent_id`, `message_sequence_key`
  - Frontend CTA flow now issues `intent_id`, emits `auth_start`, and appends attribution query params
  - Auth pages (`public/login.html`, `public/register.html`) now submit message attribution payload
  - `/api/login` + `/api/register` completion path now consumes intent and writes campaign suppression

## Validation
- Environment:
  - local dev + Jaeger + otelcol.
- Commands run:
  - (pending)
- Evidence files:
  - `tests/runs/api-curl/*` (to be recorded during implementation)
- Known gaps:
  - Exact auth controller touchpoints to be finalized in Phase C.

## Open Risks / Deferred
- Risk:
  - Auth callback paths vary by flow/provider and may bypass shared completion hook.
- Risk:
  - Intent token leakage in logs/URLs if not scrubbed.
- Deferred item:
  - Cross-device anonymous attribution beyond intent handoff.

## Resume Here
- Next action:
  - Start Phase A and create migration files for intent + suppression tables.
- Blocking question (if any):
  - Confirm suppression scope default: `campaign` for login/register prompts, `message` otherwise.
