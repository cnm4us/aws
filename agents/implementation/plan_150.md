# Plan 150: Campaign Keys + Categories (Messages & Journeys)

Status: In Progress

## Context
- We want deliberate campaign operations with strong key hygiene and cleaner analytics rollups.
- Current state:
  - `feed_message_journeys.journey_key` is already unique.
  - `feed_messages.campaign_key` is not enforced unique.
  - No first-class campaign category field on messages/journeys.

## Goals
- Prevent accidental duplicate campaign keys.
- Provide key authoring helper in admin UI.
- Add campaign category fields for rollup analytics across cloned campaign runs.

## Out of Scope
- Auto-generating keys by default.
- Backward compatibility for duplicate non-null legacy keys (DEV only assumptions allowed).
- Full analytics redesign beyond adding category dimensions.

## Locked Decisions
- Enforce uniqueness for non-null message campaign keys.
- Keep key creation deliberate (user-authored), with optional helper suffix.
- Add `campaign_category` to both Message and Journey.
- Keep `campaign_key`/`journey_key` as per-run identifiers.
- Use `campaign_category` as cross-run aggregate dimension.

## Phase Status
- A: Completed
- B: Completed
- C: Completed
- D: Completed
- E: Pending

## Phase A — Schema + Data Safety
- Goal:
  - Add category fields and unique key constraint safely.
- Steps:
  - [x] Add `feed_messages.campaign_category VARCHAR(64) NULL`.
  - [x] Add `feed_message_journeys.campaign_category VARCHAR(64) NULL`.
  - [x] Preflight check for duplicate non-null `feed_messages.campaign_key`.
  - [x] If duplicates exist in DEV, resolve by explicit rename before adding unique index.
  - [x] Add `UNIQUE INDEX uniq_feed_messages_campaign_key (campaign_key)`.
  - [x] Add supporting indexes for category filters (message/journey).
- Acceptance:
  - Migration is idempotent; unique campaign keys enforced.

## Phase B — Service/Validation Layer
- Goal:
  - Normalize and validate category values and duplicate key errors.
- Steps:
  - [x] Add normalize/validate for `campaign_category` (same character policy as keys, max 64).
  - [x] Wire create/update DTOs for message/journey categories.
  - [x] Map DB duplicate-key errors to explicit domain error (`duplicate_campaign_key`).
- Acceptance:
  - Invalid/duplicate values return deterministic API errors.

## Phase C — Admin UX (Messages & Journeys)
- Goal:
  - Make key/category authoring explicit and safe.
- Steps:
  - [x] Add `Campaign Category` input to Message editor.
  - [x] Add `Campaign Category` input to Journey editor.
  - [x] Add key helper UI next to key fields:
    - helper button appends `-yyyy-mm-dd`
    - preserves existing base key text
  - [x] Add inline validation/error rendering for duplicate key responses.
- Acceptance:
  - Admin can author category + unique keys without ambiguity.

## Phase D — Analytics + Reporting
- Goal:
  - Support aggregate analysis by category and run-level breakdown by key.
- Steps:
  - [x] Include message category in relevant analytics query joins/exports where message metadata is already joined.
  - [x] Include journey category in journey analytics views/logs where applicable.
  - [x] Add optional filters/grouping by category in admin analytics pages.
- Acceptance:
  - Can analyze performance by per-run key and cross-run category.

## Phase E — Smoke Tests + Docs
- Goal:
  - Validate behavior end-to-end and document usage.
- Steps:
- [x] Smoke: create two messages with same non-null key -> second fails.
- [x] Smoke: duplicate key helper + manual key override.
- [x] Smoke: category persisted on message and journey edit/save.
- [x] Smoke: analytics filter/group by category returns expected rows.
- [ ] Update agent docs with key/category conventions.
- Acceptance:
  - Feature is operational and documented.

## Suggested Conventions
- Message `campaign_key`: per-run key (e.g., `donate_q2_2026_a`).
- Journey `journey_key`: per-run journey key (e.g., `onboarding_q2_2026`).
- `campaign_category`: stable family (e.g., `donation_drive`, `onboarding`, `moderation`).

## Open Questions
- Should category be free text or controlled enum/allowlist?
  - Recommendation: start free text + convention; move to allowlist if drift appears.
- Should journey key helper also add date suffix?
  - Recommendation: yes, same helper behavior as message key.

## Resume Here
- Next action:
  - Implement Phase E.
