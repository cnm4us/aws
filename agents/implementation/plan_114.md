# Plan 114: Prompt Orchestration Program (Global Feed Registration Prompts)

## Goal
Design and deliver an in-feed prompt system that:
- keeps the Global Feed instantly viewable (no auth gate),
- introduces gentle registration/login prompts after engagement,
- supports multiple prompt formats (`prompt_full`, `prompt_overlay`),
- scales from simple global defaults to richer rule-driven personalization.

## Product Constraints
- No blocking modal requirement for anonymous users.
- Prompts must feel native to feed flow (same slide footprint as video cards).
- Frequency caps are mandatory (avoid spam).
- Prompt delivery must be observable (impressions, clicks, conversions).

## V1 Default Policy (Approved)
- CTA routing:
  - primary: `/register?return=/`
  - secondary: `/login?return=/`
- Anonymous identity:
  - first-party cookie `anon_session_id` (UUIDv4), TTL 30 days.
- First prompt eligibility:
  - `min_slides_viewed=6` OR `min_watch_seconds=45`.
- Session safety caps:
  - `max_prompts_per_session=2`
  - `min_slides_between_prompts=15`
  - `cooldown_seconds_after_dismiss=900` (15 minutes)
- Selection:
  - highest priority active prompt; random tie-break among same priority.
- Feature flags:
  - `PROMPTS_ENABLED=0|1` (dev default `1`, prod default `0` until rollout)
  - anonymous rollout percent gate (start at 10%).

## Bundle Strategy
- Admin-only prompt tooling must ship in admin-only React bundles.
- No prompt-admin UI code in public feed bundles.
- Routes `/admin/prompts`, `/admin/prompt-rules`, `/admin/prompt-analytics` must be lazy-loaded chunks behind admin auth.

## Observability Minimum (Program Standard)
Trace tags:
- `app.surface=global_feed`
- `app.operation=feed.prompt.decide|feed.prompt.insert|feed.prompt.render|feed.prompt.click`
- `app.prompt_id` (when known)
- `app.prompt_kind` (`prompt_full|prompt_overlay`)
- `app.prompt_category`
- `app.rule_id` (when rule matched)
- `app.rule_reason` (`eligible|below_threshold|cap_reached|cooldown|no_candidate|...`)
- `app.outcome=shown|blocked|clicked|dismissed|auth_start|auth_complete`

Metrics (low-cardinality):
- `prompt_impressions_total`
- `prompt_clicks_total`
- `prompt_dismiss_total`
- `prompt_auth_start_total`
- `prompt_auth_complete_total`
- `prompt_decision_latency_ms` (histogram)
- `prompt_insert_rate` (derived in query layer)

Structured logs:
- Decision record with caps/threshold context and `reason_code`.
- Render/insertion failures with prompt ID and surface.
- Click attribution record (session + prompt + destination route class).

Cardinality guardrails:
- Do not use raw URL/query as labels.
- Do not use `user_id` as metric label.
- Keep prompt/rule/category dimensions bounded.

## Program Shape
This is a multi-component program, not one monolith.

Component plans:
1. `agents/implementation/plan_114A.md` — Prompt Content Registry (`/admin/prompts`)
2. `agents/implementation/plan_114B.md` — Prompt Rules (`/admin/prompt-rules`)
3. `agents/implementation/plan_114C.md` — Prompt Decision Service (eligibility + selection)
4. `agents/implementation/plan_114D.md` — Feed Inserter + Client Rendering
5. `agents/implementation/plan_114E.md` — Prompt Analytics + Reporting
6. `agents/implementation/plan_114F.md` — Prompt Creative v2 (dual widgets, media backgrounds, style controls)

## Milestones
### V1 (Simple, shippable)
- Prompt content CRUD
- Global default rule set
- Anonymous session-level counters
- In-feed insertion for `prompt_full` and `prompt_overlay`
- Core analytics (impression/click/register-start/register-complete)

### V2 (Operational control)
- Admin rules by category/surface
- Better pacing controls (cooldowns, max/session, slide-distance)
- Prompt-level performance dashboard

### V3 (Optimization)
- A/B testing
- Segment-aware targeting
- Rule simulation and “why shown” explainer

## Dependency Order
1. `114A` (content model/UI) and `114C` (decision contract) can begin first.
2. `114D` depends on `114C` decision output schema.
3. `114B` can start with global defaults and then evolve to richer rule UI.
4. `114E` starts with event schema early, dashboard later.

## Program Acceptance
1. Anonymous user sees videos immediately on homepage.
2. Prompt appears only after configured engagement thresholds.
3. Prompt frequency caps are enforced per session.
4. Prompt click-through to login/register is trackable.
5. Admin can create, activate, and retire prompts without deploy.

## Risks
- Over-prompting harms retention.
- Under-instrumentation prevents rule tuning.
- Tight coupling between feed UI and prompt logic increases fragility.

Mitigations:
- Hard caps + cooldown defaults.
- Event schema first.
- Keep decisioning service separate from renderer.

## Rollout
1. Dark-launch prompt rendering with feature flag (off by default).
2. Enable for a small percent of anonymous sessions.
3. Validate retention + conversion before wider rollout.
