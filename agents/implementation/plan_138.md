# Plan 138: Reusable Message CTA Definitions + Slot-Based Placement

Status: Planned

## Feature Reference
- Feature doc: `none`

## Context
- Problem statement:
  - Current message CTA model is fixed to two fields (`primary`/`secondary`) and ties CTA definition directly to each message.
  - We need reusable CTA definitions so global admins and (later) group/channel admins can compose messages from approved CTA actions.
  - We need slot-based CTA placement so messages can support 1, 2, or 3 CTAs with deterministic layout.
- In scope:
  - CTA definition model (`label`, `target`, `type/config`, ownership scope).
  - Message creative references CTA definitions via slots.
  - Admin UI for CTA library + message CTA slot selection.
  - Runtime rendering and click tracking for slot-based CTAs.
- Out of scope:
  - Full payment provider production rollout (mock/provider-ready contract is sufficient).
  - Non-feed surfaces beyond current message injection surface.
- Constraints:
  - Backward compatibility with current `primary/secondary` message fields.
  - Preserve existing analytics and suppression behavior while migrating.
  - Enforce role-safe access for future space-scoped CTA management.

## Glossary
- `CTA Intent`:
  - The user-facing business action (what the CTA means), e.g. `donate`, `subscribe`, `verify_email`, `visit_sponsor`.
- `CTA Executor`:
  - The technical delivery path (how the action runs), e.g. `internal_link`, `provider_checkout`, `verification_flow`, `api_action`.
- `CTA Definition`:
  - Reusable admin-managed record that combines intent + executor + default label/config.
- `CTA Slot`:
  - A message-level placement reference to a CTA Definition (slot 1/2/3 + optional overrides).

## Locked Decisions
- Keep current plan_137 delivery path; this plan is additive and future-facing.
- Introduce **CTA Definition** (reusable object) and **CTA Slot** (message-level placement).
- CTA slots become the long-term source of truth, replacing hardcoded primary/secondary fields.
- CTA architecture uses two layers:
  - **Intent** (business meaning): `donate`, `subscribe`, `verify_email`, `verify_phone`, `visit_sponsor`, etc.
  - **Executor** (delivery path): `internal_link`, `provider_checkout`, `verification_flow`, `api_action`.
- Provider choice (PayPal/Stripe/Square) is executor config under an intent, not a top-level intent itself.
- Scope model for CTA definitions:
  - `global` (site-admin managed)
  - `space` (group/channel managed; limited to owned/administered space)
- Initial slot limits:
  - 1, 2, or 3 slots supported.

## Target Model (Draft)
- CTA Definition:
  - `id`, `name`, `status`, `scope_type` (`global|space`), `scope_space_id` (nullable),
  - `intent_key` (business intent, e.g. `donate`, `subscribe`, `verify_email`, `visit_sponsor`),
  - `executor_type` (`internal_link|provider_checkout|verification_flow|api_action`),
  - `label_default`,
  - `config_json` (executor-specific config),
  - audit fields.
- Message Creative CTA Slots:
  - `widgets.cta.slots: [{ slot: 1|2|3, ctaDefinitionId, labelOverride?, styleOverride? }]`
  - placement/layout controls live at widget level (with optional slot overrides).
- Legacy bridge:
  - if no slots present, map current primary/secondary config into slots at read time.

## Phase Status
- A: Completed
- B: Completed
- C: Completed
- D: Pending
- E: Pending
- F: Pending

## Phase A — Schema + Service Contract
- Goal:
  - Add CTA definition persistence and service layer with normalization/validation.
- Steps:
  - [ ] Add tables:
    - `feed_message_cta_definitions`
    - optional `feed_message_cta_definition_versions` (if versioning needed now)
  - [ ] Add repo/service for CRUD/list/filter by scope.
  - [ ] Add validation for intent + executor contract:
    - valid `intent_key` set
    - valid `executor_type`
    - executor config schema validation
  - [ ] Add resolver contract:
    - message runtime resolves CTA intent -> executor config at click time
  - [ ] Add role checks for scope ownership.
- Acceptance:
  - CTA definitions can be created/read/updated/deactivated safely by authorized admins.

## Phase B — Admin UI: CTA Library
- Goal:
  - Provide an admin UI to manage reusable CTA definitions.
- Steps:
  - [ ] Add `/admin/message-ctas` index + filters (scope, status, intent, executor).
  - [ ] Add `/admin/message-ctas/new` and `/:id` editor.
  - [ ] Editor captures:
    - intent (business meaning)
    - executor type
    - executor config form fields (type-specific)
  - [ ] Add soft-delete/archive and clone actions.
  - [ ] Add clear labels for scope and permissions.
- Acceptance:
  - Site admin can manage global CTAs; scoped CTA restrictions are enforced.

## Phase C — Message Editor Slot Model
- Goal:
  - Replace fixed primary/secondary fields with slot-based CTA references.
- Steps:
  - [ ] Add `CTA count` selector (1/2/3).
  - [ ] For each slot, select CTA definition + optional label/style override.
  - [ ] Update preview layout rules:
    - 1 slot => centered
    - 2 slots => left/right
    - 3 slots => left/center/right
  - [ ] Keep temporary backward-compatible hidden bridge for existing payloads.
- Acceptance:
  - Message editor composes CTA slots from reusable definitions and preview matches runtime.

## Phase D — Feed Runtime + Click Flow
- Goal:
  - Render CTA slots in feed and preserve event attribution.
- Steps:
  - [ ] Runtime resolves CTA definitions for each slot (intent + executor).
  - [ ] Render 1–3 CTA buttons with deterministic alignment.
  - [ ] Wire click/start/complete events with slot metadata:
    - `message_cta_slot`, `message_cta_definition_id`, `message_cta_kind`
    - include `message_cta_intent`, `message_cta_executor`
  - [ ] Keep auth intent flow for auth CTA kinds.
- Acceptance:
  - Slot-based CTAs render and route correctly; attribution includes slot + definition identity.

## Phase E — Migration + Compatibility Cleanup
- Goal:
  - Safely migrate old message CTA data and reduce legacy coupling.
- Steps:
  - [ ] Read-time mapping from legacy `primary/secondary` when slots absent.
  - [ ] Optional one-time migration script to write explicit slots for existing messages.
  - [ ] Keep legacy fields populated for one release window.
  - [ ] Remove dead/duplicate fields after validation window.
- Acceptance:
  - Existing messages continue to function while new slot model becomes canonical.

## Phase F — Scoped Admin Rollout + Observability
- Goal:
  - Enable group/channel admins to use constrained CTA tooling with auditability.
- Steps:
  - [ ] Expose scoped CTA library in space-admin context.
  - [ ] Lock available surfaces/scope values in space-admin UI.
  - [ ] Add logs/traces for CTA definition and slot resolution decisions.
  - [ ] Extend debug bundle summaries for slot-level CTA behavior.
- Acceptance:
  - Space admins can only manage/use CTAs in allowed scope; debugging and analytics remain clear.

## Risks / Open Questions
- Do we need CTA definition version pinning per message to avoid “definition changed after publish” surprises?
- Should slot-level style overrides be restricted (for design consistency) or fully flexible?
- Should CTA definitions support localization now or defer?
- How strict should permission boundaries be for cross-space template reuse?
- Do we allow direct provider execution from feed for all intents, or require universal intermediate pages for high-risk intents (donate/subscribe)?

## Validation Strategy
- Unit:
  - service validation for CTA kinds/config and scope checks.
- Integration:
  - message save/load with slot model + legacy fallback.
- Runtime smoke:
  - 1/2/3 CTA layouts in feed, click/event verification, auth-complete suppression unaffected.
- Observability:
  - Jaeger tags and terminal logs include CTA slot + definition identifiers.

## Resume Here
- Next action:
  - Begin Plan 138 Phase D (Feed Runtime + Click Flow).
- Blocking question (if any):
  - none
