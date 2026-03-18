# Analytics Roadmap

This roadmap links strategy docs in this folder to implementation plans.

## Current Strategy Docs
- Event design: `agents/analytics/EVENT_MATRIX.md`
- Field definitions: `agents/analytics/DIMENSION_CATALOG.md`
- Report definitions: `agents/analytics/REPORT_CATALOG.md`
- Quality checks: `agents/analytics/QA_INVARIANTS.md`
- Moderation model: `agents/analytics/MODERATION_ANALYTICS.md`
- Credibility model: `agents/analytics/CREDIBILITY_MODEL.md`

## Execution Plans
- Foundation and sink controls: `agents/implementation/plan_115.md`
- Product analytics expansion: `agents/implementation/plan_118.md`
- Message sequencing dependency: `agents/implementation/plan_117.md`

## Suggested Sequence
1. Lock canonical event schema and dimensions.
2. Align feed/message emitters to canonical event names.
3. Harden ingest + dedupe.
4. Build hourly/daily rollups and reporting endpoints.
5. Build admin dashboards from rollups.
6. Add scoped analytics for group/channel admins and creators.
7. Add moderation rollups and moderation dashboards.
8. Add two-layer moderation reporting (`global_floor` vs `space_culture`) with scope-aware enforcement metrics.
9. Add trust/verification analytics and permission/reach reporting.
10. Add credibility scoring shadow mode + tier-based reach policy reporting.

## Change Control
- Any new event or field requires updates to:
  - `EVENT_MATRIX.md`
  - `DIMENSION_CATALOG.md`
  - at least one row in `REPORT_CATALOG.md`
  - relevant checks in `QA_INVARIANTS.md`
