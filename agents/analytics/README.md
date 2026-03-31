# Analytics Docs

This folder holds product analytics strategy and schema design docs that drive implementation plans.
Current priority: front burner next, after current cleanup/modification work completes.

## Files
- `EVENT_MATRIX.md` - events, required fields, and report mappings.
- `DIMENSION_CATALOG.md` - canonical dimension definitions and enums.
- `REPORT_CATALOG.md` - KPI/report definitions, formulas, and freshness targets.
- `QA_INVARIANTS.md` - validation rules and sanity checks for analytics quality.
- `MODERATION_ANALYTICS.md` - moderation lifecycle events, dimensions, and KPIs.
- `CREDIBILITY_MODEL.md` - trust scoring design (private score, public tier, enforcement mapping).
- `ROADMAP.md` - phased rollout and links to implementation plans.

## Working Rule
Update these docs before changing event instrumentation or reporting logic.

## Campaign Conventions
- `message_campaign_key`: per-run message identifier (unique among non-null message keys).
- `journey_key`: per-run journey identifier (unique).
- `message_campaign_category` / `journey_campaign_category`: stable cross-run family label used for aggregate reporting.
- Recommended format: lowercase slug with `_` or `-` (e.g., `donation_drive`, `onboarding_q2`).

Moderation analytics follows a two-layer policy model:
- `global_floor` (sitewide non-negotiables)
- `space_culture` (group/channel-specific norms)

Trust analytics tracks verification level as an event-time snapshot for permission and reach decisions.
