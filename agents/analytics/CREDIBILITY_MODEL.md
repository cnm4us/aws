# Credibility Model

## Purpose
Credibility is a trust-control system used to:
- reduce bot/malicious/incompetent actor impact,
- preserve space autonomy,
- reward consistently high-quality publishing.

It is **not** a popularity score.

## Design Principles
- **Two-layer trust model**
  - `global_floor_credibility`: platform-wide safety/truth baseline.
  - `space_culture_credibility`: compatibility with a specific group/channel culture.
- **Private score, public tier**
  - Internal numeric score for decisions.
  - Publicly visible tier/badge for user-facing transparency.
- **Action only on resolved outcomes**
  - Reports alone do not change credibility.
  - Credibility changes require moderation resolution.
- **Recency-aware**
  - Older violations decay in impact over time.
- **Reversible**
  - Appeals and overturned actions restore credibility.

## Internal Structure
## Components
- `global_floor_score` (0–100)
- `space_culture_score[space_id]` (0–100 per space)
- `verification_multiplier` (bounded positive modifier)
- `abuse_risk_multiplier` (bounded negative modifier)

## Public Output
- `credibility_tier` (public):
  - `High`
  - `Established`
  - `Limited`
  - `Restricted`
- Optional public flags:
  - `under_review`
  - `recent_overturn`

Do not expose raw numeric scores publicly.

## Signal Inputs
## Negative signals (resolved only)
- confirmed global-floor violation
- confirmed space-culture violation
- repeated violations in rolling windows
- sitewide enforcement actions

## Positive signals
- sustained compliant publishing over time
- successful verification milestones (`email`, `phone`, `idv`)
- successful appeals (overturned actions)

## Neutral/no-score signals
- unverified reports
- unresolved reports
- high engagement alone (likes/views are not direct credibility)

## Weighting Rules (v1)
- Severity-weighted penalties: low/med/high.
- Confidence-adjusted penalties:
  - high confidence -> full weight,
  - medium -> reduced,
  - low -> minimal or no credibility impact.
- Recency decay:
  - fixed half-life (example: 30 or 60 days).
- Repeat escalation:
  - stronger penalties for repeated same-category resolved violations in 30/90 day windows.

## Enforcement Mapping
Use credibility as an input, not sole decider.

- `High/Established`:
  - normal distribution reach.
- `Limited`:
  - reduced initial reach or slower distribution ramp.
- `Restricted`:
  - strong throttling, potential publish restrictions depending on policy layer.

Policy guardrails:
- Space-culture violations should primarily affect space-scoped behavior.
- Global-floor violations can affect sitewide reach and permissions.

## Explainability
Each credibility change must include:
- `policy_layer` (`global_floor|space_culture`)
- `policy_id`, `policy_version`
- `reason_code`
- `decision_id` (moderation resolution reference)
- `delta` and post-change score
- timestamp

User-facing explanation should be plain-language category based, not moderator notes.

## Appeals and Restoration
- On appeal overturn:
  - revert associated penalty deltas,
  - apply optional restoration bonus (bounded),
  - record `restored_by_appeal=true`.
- Keep immutable audit log of all score changes.

## Anti-Abuse Protections
- Report-brigading resistance:
  - no score change from report volume alone.
- Suspicious reporter-quality weighting:
  - low-quality reporter clusters do not amplify penalties.
- Cooldown on repeated identical events:
  - dedupe identical action signals in short windows.

## Data Model Additions (Analytics)
Recommended fields for credibility analytics:
- `credibility_delta`
- `credibility_score_after`
- `credibility_layer` (`global_floor|space_culture`)
- `credibility_tier_after`
- `credibility_reason_code`
- `restored_by_appeal`

Recommended events:
- `credibility_changed`
- `credibility_tier_changed`
- `reach_policy_applied`

## Reporting (Admin)
- Credibility distribution by tier over time.
- Credibility change volume by reason/policy layer.
- Reach throttling volume by tier.
- Appeal overturn impact on credibility.
- Cross-space offender recurrence with credibility trend.

## Governance
- Version scoring policy (`credibility_policy_version`).
- Log every model/config change with effective timestamp.
- Backtest major changes before rollout.
- Provide internal runbooks for moderator and support teams.

## Rollout Suggestion
1. **Shadow mode**: compute scores, do not enforce.
2. Validate fairness and false positives.
3. Enable limited reach throttling for lowest tier.
4. Expand to permission gating where policy requires.
