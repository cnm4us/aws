#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAEGER_TOOL="$ROOT_DIR/scripts/jaeger-query.sh"
LOOKBACK="${1:-30m}"
SERVICE="${DEBUG_BUNDLE_SERVICE:-aws-mediaconvert-service}"
OUT_DIR="$ROOT_DIR/tests/runs/api-curl/journey-reentry-smoke-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

run_count() {
  local key="$1"
  shift
  local out="$OUT_DIR/jaeger-${key}.json"
  if "$JAEGER_TOOL" traces --service "$SERVICE" --lookback "$LOOKBACK" --out "$out" "$@" >/dev/null 2>&1; then
    local c
    c="$(jq '.data | length' "$out" 2>/dev/null || echo 0)"
    printf '%s\t%s\n' "$key" "$c"
  else
    printf '%s\terror\n' "$key"
  fi
}

{
  printf 'query_key\ttrace_count\n'
  run_count "decide_all" --tag app.operation=feed.message.decide
  run_count "journey_delivery" --tag app.operation=feed.message.decide --tag app.delivery_context=journey
  run_count "suppression_bypass" --tag app.operation=feed.message.decide --tag app.suppression_applied=false --tag app.suppression_bypass_reason=journey_delivery
  run_count "reentry_triggered" --tag app.operation=feed.message.decide --tag app.journey_reentry_triggered=true
  run_count "standalone_suppressed" --tag app.operation=feed.message.decide --tag app.delivery_context=standalone --tag app.suppression_applied=true
  run_count "group_surface" --tag app.operation=feed.message.decide --tag app.surface=group
  run_count "channel_surface" --tag app.operation=feed.message.decide --tag app.surface=channel
} | tee "$OUT_DIR/counts.tsv"

cat > "$OUT_DIR/notes.txt" <<'TXT'
Journey Re-entry Smoke Matrix

Prereqs
1) Start stack and Jaeger.
2) Configure one journey with re-entry enabled (reenter_after_days), active status, and at least one active step.
3) Ensure journey step CTA can produce goal completion (example: auth.login_complete).

M1) Re-entry (no suppression clear)
1) Use /admin/dev-tools -> Clear Journey State (All).
2) Start as anon in private session and render step 1.
3) Complete goal (login CTA -> login success).
4) Verify terminal run exists in feed_message_journey_instances.
5) Apply cooldown SQL to the completed user run (set completed_at/last_seen_at to > cooldown).
6) Refresh feed as same user.
Expected:
- Step 1 appears again WITHOUT clearing suppressions.
- Jaeger contains app.journey_reentry_triggered=true and app.journey_instance_id.

M2) Standalone suppression unaffected
1) Trigger standalone message CTA completion for a campaign key.
2) Refresh same surface.
Expected:
- Standalone message suppressed.
- Jaeger contains app.delivery_context=standalone and app.suppression_applied=true.

M3) Journey surfaces parity
1) Configure journey targeting for group and channel surfaces.
2) Exercise journey in group and channel feeds.
Expected:
- Same journey progression behavior as global_feed.
- Jaeger includes app.delivery_context=journey and relevant app.surface values.

Helpful Jaeger checks
- npm run jaeger:query -- traces --lookback 30m --tag app.operation=feed.message.decide --tag app.journey_reentry_triggered=true --summary
- npm run jaeger:query -- traces --lookback 30m --tag app.operation=feed.message.decide --tag app.suppression_bypass_reason=journey_delivery --summary
TXT

echo "journey re-entry smoke artifact directory:"
echo "  $OUT_DIR"
