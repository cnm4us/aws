# Plan 143: Remove `audience_segment` and Use Rulesets-Only Targeting

Status: Draft

## Context
- Message decision currently applies baseline filter using `audience_segment` and then applies eligibility rulesets.
- We now have rulesets (inclusion/exclusion) that can fully express audience targeting.
- Project state is development-only, single developer/tester, no backward-compatibility requirement.

## Goal
- Remove `audience_segment` from message targeting model.
- Make eligibility rulesets the single targeting mechanism.
- Keep behavior explicit and easy to reason about in decision telemetry.

## Non-Goals
- Migrating legacy production data safely.
- Maintaining old audience-segment APIs/UI behavior.
- Creating complex visual rule builders in this plan.

## Target End State
- `feed_messages` has no effective audience-segment control.
- Admin message editor has no Audience field.
- Decision engine does not filter by `audienceSegment`; it filters by ruleset only (plus existing schedule/surface/suppression/session gates).
- If a message has no ruleset, it is considered eligible for all viewers (subject to other gates).

## Destructive/Breaking Changes (Intentional)
- Remove `audience_segment` from:
  - DB schema usage
  - message repo/service/types DTOs
  - admin message pages/forms/filtering
  - decision-engine baseline filter path
  - telemetry fields that imply audience segment targeting

## Rollout Phases

### Phase A — Schema + Domain Contract Cleanup
- Drop `audience_segment` from `feed_messages` schema and related indexes (or leave column physically present but fully ignored for one short transition commit, then drop in same plan).
- Remove `MessageAudienceSegment` from message feature types where used for message CRUD.
- Remove normalization/validation of `audienceSegment` in `messages/service.ts`.
- Remove read/write/select references in `messages/repo.ts`.
- Acceptance:
  - Message CRUD compiles and works without `audienceSegment` inputs.
 - Status: Completed (2026-03-26)

### Phase B — Admin UI/API Cleanup
- Remove Audience field from:
  - `/admin/messages` list filters
  - `/admin/messages/new`
  - `/admin/messages/:id`
- Remove audience column from messages table view.
- Remove payload parsing of audience in `buildMessageCreateOrUpdatePayload`.
- Keep API tolerant to extra `audienceSegment` input by ignoring it (or reject with clear validation error; choose one and document).
- Acceptance:
  - Admin can create/edit messages without any audience selector.
 - Status: Completed (2026-03-26)

### Phase C — Decision Engine Simplification
- Remove baseline `audienceSegment` filter from `messagesSvc.listActiveForFeed` calls in `message-decision/service.ts`.
- Keep request-time audience resolution only if needed for analytics context; do not use it to gate candidates.
- Ensure ruleset evaluation handles auth vs anon targeting deterministically:
  - `user.is_authenticated`
  - `support.is_subscriber`
  - etc.
- Acceptance:
  - Candidate pool no longer changes by `audienceSegment`; changes only by ruleset + existing gates.

### Phase D — Observability and Debug Contract Update
- Remove stale audience-targeting semantics from logs/tags where misleading.
- Keep useful context tags (viewer/auth state) if still valuable for analysis, but not as a targeting control.
- Ensure decision debug includes:
  - candidate counts pre/post ruleset
  - explicit ruleset drop reasons
- Acceptance:
  - Jaeger/Pino clearly reflect “ruleset-only targeting”.

### Phase E — Smoke Tests (Ruleset-Only Matrix)
- Scenario 1: No ruleset attached → message can appear for anon and auth.
- Scenario 2: Ruleset with `user.is_authenticated=true` → anon blocked, auth eligible.
- Scenario 3: Ruleset with `support.is_subscriber=false` → subscriber blocked.
- Scenario 4: Ruleset with exclusion `support.donated_within_days` → recent donor blocked.
- For each scenario verify:
  - UI behavior
  - `/api/feed/message-decision` response reason
  - Jaeger tags: ruleset result/reason/id

### Phase F — Final Sweep
- Remove any dead constants/options/docs that reference message audience segment as a targeting field.
- Update plan index/docs to note rulesets are now the single targeting model.
- Acceptance:
  - No active code path depends on `audience_segment` for message targeting.

## Risks
- Risk: over-targeting if message has no ruleset.
  - Mitigation: optional guardrail later (e.g., warning badge in admin if no ruleset attached).
- Risk: hidden stale references in pages/forms.
  - Mitigation: grep sweep + build + smoke matrix.

## Open Decisions
- Strictness on unknown client payload keys:
  - Option 1 (recommended): ignore obsolete `audienceSegment` keys.
  - Option 2: reject with validation error.
- Recommended for dev speed: Option 1.
- Decision: Option 1 selected (2026-03-26).

## Resume Here
- Start Phase A and remove `audience_segment` from message repo/service/types first; then run build.
