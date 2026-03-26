#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOOKBACK="${DEBUG_BUNDLE_LOOKBACK:-1h}"
SERVICE="${DEBUG_BUNDLE_SERVICE:-aws-mediaconvert-service}"
DEST_ROOT="$ROOT_DIR/tests/runs/api-curl"
RUN_ID=""
BASE_NAME="debug-bundle"
MODE="${DEBUG_BUNDLE_MODE:-mixed}"

usage() {
  cat <<'USAGE'
Usage:
  debug-bundle.sh [--run-id <id>] [--base-name <name>] [--lookback <window>] [--service <name>] [--dest-root <dir>] [--mode <message|feed|mixed>]

Examples:
  npm run debug:bundle
  npm run debug:bundle -- --lookback 15m
  npm run debug:bundle -- --run-id 2026-03-20_message-stuck --lookback 2h
  npm run debug:bundle -- --base-name message-bundle --lookback 30m
  npm run debug:bundle -- --lookback 30m --mode feed
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --base-name) BASE_NAME="${2:-}"; shift 2 ;;
    --lookback) LOOKBACK="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --dest-root) DEST_ROOT="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

case "$MODE" in
  message|feed|mixed) ;;
  *) echo "error: invalid --mode '$MODE' (expected message|feed|mixed)" >&2; exit 1 ;;
esac

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="${BASE_NAME}-$(date -u +%Y%m%dT%H%M%SZ)"
fi

if [[ "$DEST_ROOT" != /* ]]; then
  DEST_ROOT="$ROOT_DIR/$DEST_ROOT"
fi

RUN_DIR="$DEST_ROOT/$RUN_ID"
ART_DIR="$RUN_DIR/artifacts"
mkdir -p "$ART_DIR"

latest_file() {
  local dir="$1"
  local f
  f="$(ls -1t "$dir"/* 2>/dev/null | head -n 1 || true)"
  if [[ -z "$f" ]]; then
    return 1
  fi
  printf '%s\n' "$f"
}

TERMINAL_SRC=""
CONSOLE_SRC=""

if TERMINAL_SRC="$(latest_file "$ROOT_DIR/debug/terminal")"; then
  cp "$TERMINAL_SRC" "$ART_DIR/terminal-latest.log"
fi

if CONSOLE_SRC="$(latest_file "$ROOT_DIR/debug/console")"; then
  cp "$CONSOLE_SRC" "$ART_DIR/console-latest.ndjson"
fi

JAEGER_TOOL="$ROOT_DIR/scripts/jaeger-query.sh"
PRESETS=(
  "message_decide"
  "message_fetch"
  "message_event"
  "admin_messages"
  "admin_message_save"
  "admin_message_analytics"
  "support_page"
  "my_support_view"
  "payment_checkout_page"
  "payment_checkout_start"
  "payment_webhook"
  "payment_webhook_ingest"
  "payment_subscription_action"
)

JAEGER_BASE_URL="${JAEGER_BASE_URL:-http://127.0.0.1:16686}"
JAEGER_AVAILABLE="0"
if curl -fsS "$JAEGER_BASE_URL/api/services" >/dev/null 2>&1; then
  JAEGER_AVAILABLE="1"
fi

{
  printf "preset\ttrace_count\n"
  if [[ "$JAEGER_AVAILABLE" != "1" ]]; then
    for p in "${PRESETS[@]}"; do
      printf "%s\t%s\n" "$p" "unavailable"
    done
  else
    for p in "${PRESETS[@]}"; do
      out="$ART_DIR/jaeger-${p}.json"
      if "$JAEGER_TOOL" preset "$p" --service "$SERVICE" --lookback "$LOOKBACK" --out "$out" >/dev/null 2>&1; then
        c="$(jq '.data | length' "$out" 2>/dev/null || echo "0")"
        printf "%s\t%s\n" "$p" "$c"
      else
        printf "%s\t%s\n" "$p" "error"
      fi
    done
  fi
} > "$ART_DIR/jaeger-counts.tsv"

if [[ -f "$ART_DIR/jaeger-message_event.json" ]]; then
  jq -r '.data[].spans[] | select(.operationName=="HTTP POST /api/feed/message-events") | .tags[]?.key' \
    "$ART_DIR/jaeger-message_event.json" 2>/dev/null | sort -u > "$ART_DIR/jaeger-message-event-tags.txt" || true
fi
if [[ -f "$ART_DIR/jaeger-payment_webhook.json" ]]; then
  jq -r '.data[].spans[] | select(.operationName=="HTTP POST /api/payments/paypal/webhook" or .operationName=="HTTP POST /api/payments/paypal/webhook/:mode") | .tags[]?.key' \
    "$ART_DIR/jaeger-payment_webhook.json" 2>/dev/null | sort -u > "$ART_DIR/jaeger-payment-webhook-tags.txt" || true
fi

if [[ -f "$ART_DIR/console-latest.ndjson" ]]; then
  jq -Rr 'fromjson? | .category // empty' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-categories.txt" || true
  jq -Rr 'fromjson? | .event // empty' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-events.txt" || true
  jq -Rr 'fromjson? | select(.event=="debug:config") | .payload | @json' "$ART_DIR/console-latest.ndjson" | tail -n 1 > "$ART_DIR/client-debug-config.json" || true
  jq -Rr 'fromjson? | select(.category=="message") | .event // empty' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-mode-message-events.txt" || true
  jq -Rr 'fromjson? | select(.category=="feed" or .category=="slides" or .category=="index" or .category=="sequence") | "\(.category)\t\(.event)"' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-mode-feed-events.txt" || true
  jq -Rr 'fromjson? | "\(.category)\t\(.event)"' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-mode-mixed-events.txt" || true
  {
    content_slide_visits="$(jq -Rr 'fromjson? | select(.category=="slides" and (.event|startswith("index ->")) and ((.payload.detail.key // "")|startswith("content:"))) | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    message_slide_visits="$(jq -Rr 'fromjson? | select(.category=="slides" and (.event|startswith("index ->")) and ((.payload.detail.key // "")|startswith("message:"))) | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    unique_content_slides="$(jq -Rr 'fromjson? | select(.category=="slides" and (.event|startswith("index ->")) and ((.payload.detail.key // "")|startswith("content:"))) | (.payload.detail.slideId // empty)' "$ART_DIR/console-latest.ndjson" | sort -u | awk 'NF' | wc -l | tr -d ' ')"
    unique_active_render_content_slides="$(jq -Rr 'fromjson? | select(.category=="slides" and .event=="render slide" and (.payload.detail.active==true)) | (.payload.detail.slideId // empty)' "$ART_DIR/console-latest.ndjson" | rg '^v-' | sort -u | wc -l | tr -d ' ')"
    unique_messages_via_index="$(jq -Rr 'fromjson? | select(.category=="slides" and (.event|startswith("index ->")) and ((.payload.detail.key // "")|startswith("message:"))) | ((.payload.detail.key // "") | split(":")[1] // empty)' "$ART_DIR/console-latest.ndjson" | sort -u | awk 'NF' | wc -l | tr -d ' ')"
    message_insert_applied="$(jq -Rr 'fromjson? | select(.category=="message" and .event=="decision:insert:applied") | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    message_impressions="$(jq -Rr 'fromjson? | select(.category=="message" and .event=="impression:recorded") | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    message_pass_throughs="$(jq -Rr 'fromjson? | select(.category=="message" and .event=="pass_through:recorded") | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    unique_messages_impressed="$(jq -Rr 'fromjson? | select(.category=="message" and .event=="impression:recorded") | (.payload.detail.message_id // empty)' "$ART_DIR/console-latest.ndjson" | sort -u | awk 'NF' | wc -l | tr -d ' ')"
    unique_messages_passed="$(jq -Rr 'fromjson? | select(.category=="message" and .event=="pass_through:recorded") | (.payload.detail.message_id // empty)' "$ART_DIR/console-latest.ndjson" | sort -u | awk 'NF' | wc -l | tr -d ' ')"
    content_slides_seen_proxy="${unique_content_slides:-0}"
    if [[ "${unique_active_render_content_slides:-0}" -gt "${content_slides_seen_proxy:-0}" ]]; then
      content_slides_seen_proxy="${unique_active_render_content_slides:-0}"
    fi
    message_slides_seen_proxy="${message_slide_visits:-0}"
    if [[ "${unique_messages_impressed:-0}" -gt "${message_slides_seen_proxy:-0}" ]]; then
      message_slides_seen_proxy="${unique_messages_impressed:-0}"
    fi
    printf "metric\tvalue\n"
    printf "content_slides_seen_proxy\t%s\n" "${content_slides_seen_proxy:-0}"
    printf "message_slides_seen_proxy\t%s\n" "${message_slides_seen_proxy:-0}"
    printf "content_slide_visits\t%s\n" "${content_slide_visits:-0}"
    printf "message_slide_visits\t%s\n" "${message_slide_visits:-0}"
    printf "unique_content_slides_seen\t%s\n" "${unique_content_slides:-0}"
    printf "unique_active_render_content_slides\t%s\n" "${unique_active_render_content_slides:-0}"
    printf "unique_messages_seen_by_index\t%s\n" "${unique_messages_via_index:-0}"
    printf "message_insertions_applied\t%s\n" "${message_insert_applied:-0}"
    printf "message_impressions_recorded\t%s\n" "${message_impressions:-0}"
    printf "message_pass_through_recorded\t%s\n" "${message_pass_throughs:-0}"
    printf "unique_messages_impressed\t%s\n" "${unique_messages_impressed:-0}"
    printf "unique_messages_passed_through\t%s\n" "${unique_messages_passed:-0}"
  } > "$ART_DIR/human-signals.tsv"
  {
    content_slide_visits="$(awk -F'\t' '$1=="content_slides_seen_proxy"{print $2}' "$ART_DIR/human-signals.tsv" | head -n1)"
    message_slide_visits="$(awk -F'\t' '$1=="message_slides_seen_proxy"{print $2}' "$ART_DIR/human-signals.tsv" | head -n1)"
    message_impressions="$(awk -F'\t' '$1=="message_impressions_recorded"{print $2}' "$ART_DIR/human-signals.tsv" | head -n1)"
    message_pass_throughs="$(awk -F'\t' '$1=="message_pass_through_recorded"{print $2}' "$ART_DIR/human-signals.tsv" | head -n1)"
    cs="${content_slide_visits:-0}"
    ms="${message_slide_visits:-0}"
    mi="${message_impressions:-0}"
    mp="${message_pass_throughs:-0}"
    ms_word="message slides"; [[ "$ms" = "1" ]] && ms_word="message slide"
    mi_word="impressions"; [[ "$mi" = "1" ]] && mi_word="impression"
    mp_word="pass-throughs"; [[ "$mp" = "1" ]] && mp_word="pass-through"
    printf "Saw %s content slides, %s %s, recorded %s %s, recorded %s %s.\n" \
      "$cs" "$ms" "$ms_word" "$mi" "$mi_word" "$mp" "$mp_word"
  } > "$ART_DIR/session-story.txt"
  {
    feed_render="$(jq -Rr 'fromjson? | select(.category=="slides" and .event=="render slide") | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    feed_reanchor="$(jq -Rr 'fromjson? | select((.category=="slides" and (.event=="reanchor start" or .event=="reanchor end")) or (.category=="index" and (.event=="reanchor:start" or .event=="reanchor:end"))) | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    feed_sequence="$(jq -Rr 'fromjson? | select((.category=="feed" and (.event=="hook:sequence_active_key_changed" or .event=="hook:sequence_window_shift" or .event=="hook:sequence_message_inserted")) or (.category=="sequence")) | .event' "$ART_DIR/console-latest.ndjson" | wc -l | tr -d ' ')"
    if [[ "${feed_render:-0}" -gt 0 ]]; then echo "PASS: slides render events observed (${feed_render})"; else echo "WARN: no slides render events observed"; fi
    if [[ "${feed_reanchor:-0}" -gt 0 ]]; then echo "PASS: reanchor events observed (${feed_reanchor})"; else echo "WARN: no reanchor events observed"; fi
    if [[ "${feed_sequence:-0}" -gt 0 ]]; then echo "PASS: sequence/index transition events observed (${feed_sequence})"; else echo "WARN: no sequence/index transition events observed"; fi
  } > "$ART_DIR/feed-mode-checks.txt"
fi

if [[ -f "$ART_DIR/terminal-latest.log" ]]; then
  rg -o 'feed\.message\.[a-z_]+' "$ART_DIR/terminal-latest.log" | sort | uniq -c | sort -nr > "$ART_DIR/terminal-feed-message-signals.txt" || true
  rg -o 'payments\.[a-z_\.]+' "$ART_DIR/terminal-latest.log" | sort | uniq -c | sort -nr > "$ART_DIR/terminal-payment-signals.txt" || true
fi

window_end_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
window_start_iso="$(python3 - "$LOOKBACK" "$window_end_iso" <<'PY'
import re
import sys
from datetime import datetime, timedelta, timezone

lookback = sys.argv[1].strip().lower()
end_iso = sys.argv[2].strip()
end = datetime.fromisoformat(end_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
m = re.fullmatch(r"(\d+)([smhd])", lookback)
if not m:
    print((end - timedelta(hours=1)).isoformat().replace("+00:00", "Z"))
    raise SystemExit(0)
n = int(m.group(1))
u = m.group(2)
if u == "s":
    delta = timedelta(seconds=n)
elif u == "m":
    delta = timedelta(minutes=n)
elif u == "h":
    delta = timedelta(hours=n)
else:
    delta = timedelta(days=n)
print((end - delta).isoformat().replace("+00:00", "Z"))
PY
)"
window_start_epoch="$(python3 - "$window_start_iso" <<'PY'
import sys
from datetime import datetime, timezone
dt = datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).astimezone(timezone.utc)
print(int(dt.timestamp()))
PY
)"

python3 "$ROOT_DIR/scripts/build-debug-timeline.py" \
  --artifacts-dir "$ART_DIR" \
  --window-start-iso "$window_start_iso" \
  --window-end-iso "$window_end_iso" \
  --jaeger-base-url "$JAEGER_BASE_URL" >/dev/null 2>&1 || true

source_warnings=()
if [[ -f "$ART_DIR/terminal-latest.log" ]]; then
  terminal_mtime="$(stat -c %Y "$ART_DIR/terminal-latest.log" 2>/dev/null || echo 0)"
  if [[ "$terminal_mtime" -lt "$window_start_epoch" ]]; then
    source_warnings+=("WARN: terminal-latest.log mtime is older than bundle window start")
  fi
fi
if [[ -f "$ART_DIR/console-latest.ndjson" ]]; then
  console_mtime="$(stat -c %Y "$ART_DIR/console-latest.ndjson" 2>/dev/null || echo 0)"
  if [[ "$console_mtime" -lt "$window_start_epoch" ]]; then
    source_warnings+=("WARN: console-latest.ndjson mtime is older than bundle window start")
  fi
fi

now_iso="$window_end_iso"
{
  echo "# Debug Bundle"
  echo
  echo "- Run ID: \`$RUN_ID\`"
  echo "- Captured at (UTC): \`$now_iso\`"
  echo "- Service: \`$SERVICE\`"
  echo "- Jaeger lookback: \`$LOOKBACK\`"
  echo "- Analysis mode: \`$MODE\`"
  echo "- Bundle window (UTC): \`$window_start_iso\` -> \`$window_end_iso\`"
  echo "- Jaeger API: \`$JAEGER_BASE_URL\` (\`$([ "$JAEGER_AVAILABLE" = "1" ] && echo reachable || echo unreachable)\`)"
  echo
  echo "## Sources"
  echo "- Latest terminal log: \`${TERMINAL_SRC:-not_found}\`"
  echo "- Latest browser console log: \`${CONSOLE_SRC:-not_found}\`"
  echo
  echo "## Artifacts"
  echo "- \`artifacts/terminal-latest.log\`"
  echo "- \`artifacts/console-latest.ndjson\`"
  echo "- \`artifacts/jaeger-counts.tsv\`"
  echo "- \`artifacts/jaeger-http-operation-counts.tsv\`"
  echo "- \`artifacts/jaeger-message-id-counts.tsv\`"
  echo "- \`artifacts/jaeger-journey-counts.tsv\`"
  echo "- \`artifacts/expectation-checks.txt\`"
  echo "- \`artifacts/jaeger-message_decide.json\`"
  echo "- \`artifacts/jaeger-message_fetch.json\`"
  echo "- \`artifacts/jaeger-message_event.json\`"
  echo "- \`artifacts/jaeger-admin_messages.json\`"
  echo "- \`artifacts/jaeger-admin_message_save.json\`"
  echo "- \`artifacts/jaeger-admin_message_analytics.json\`"
  echo "- \`artifacts/jaeger-support_page.json\`"
  echo "- \`artifacts/jaeger-my_support_view.json\`"
  echo "- \`artifacts/jaeger-payment_checkout_page.json\`"
  echo "- \`artifacts/jaeger-payment_checkout_start.json\`"
  echo "- \`artifacts/jaeger-payment_webhook.json\`"
  echo "- \`artifacts/jaeger-payment_webhook_ingest.json\`"
  echo "- \`artifacts/jaeger-payment_subscription_action.json\`"
  echo "- \`artifacts/jaeger-message-event-tags.txt\`"
  echo "- \`artifacts/jaeger-payment-webhook-tags.txt\`"
  echo "- \`artifacts/console-categories.txt\`"
  echo "- \`artifacts/console-events.txt\`"
  echo "- \`artifacts/client-debug-config.json\`"
  echo "- \`artifacts/console-mode-message-events.txt\`"
  echo "- \`artifacts/console-mode-feed-events.txt\`"
  echo "- \`artifacts/console-mode-mixed-events.txt\`"
  echo "- \`artifacts/feed-mode-checks.txt\`"
  echo "- \`artifacts/terminal-feed-message-signals.txt\`"
  echo "- \`artifacts/terminal-payment-signals.txt\`"
  echo "- \`artifacts/timeline.ndjson\`"
  echo "- \`artifacts/timeline-top.txt\`"
  echo "- \`artifacts/human-signals.tsv\`"
  echo "- \`artifacts/session-story.txt\`"
  echo
  echo "## Quick Assessment"
  echo
  echo "### Jaeger Trace Counts (Tag-Based)"
  echo
  echo '```text'
  cat "$ART_DIR/jaeger-counts.tsv"
  echo '```'
  if [[ -f "$ART_DIR/jaeger-http-operation-counts.tsv" ]]; then
    echo
    echo "### Jaeger Trace Counts (HTTP Operation Only)"
    echo
    echo '```text'
    cat "$ART_DIR/jaeger-http-operation-counts.tsv"
    echo '```'
  fi
  if [[ -f "$ART_DIR/jaeger-message-id-counts.tsv" ]]; then
    echo
    echo "### Per-Message ID Counts"
    echo
    echo '```text'
    cat "$ART_DIR/jaeger-message-id-counts.tsv"
    echo '```'
  fi
  if [[ -f "$ART_DIR/jaeger-journey-counts.tsv" ]]; then
    echo
    echo "### Journey Decision Counts"
    echo
    echo '```text'
    cat "$ART_DIR/jaeger-journey-counts.tsv"
    echo '```'
  fi
  if [[ -f "$ART_DIR/expectation-checks.txt" ]]; then
    echo
    echo "### Expectation Checks"
    echo
    echo '```text'
    cat "$ART_DIR/expectation-checks.txt"
    echo '```'
  fi
  if [[ "${#source_warnings[@]}" -gt 0 ]]; then
    echo
    echo "### Source Freshness Warnings"
    echo
    echo '```text'
    for w in "${source_warnings[@]}"; do
      echo "$w"
    done
    echo '```'
  fi
  if [[ -f "$ART_DIR/console-categories.txt" ]]; then
    echo
    echo "### Console category counts (top)"
    echo
    echo '```text'
    head -n 12 "$ART_DIR/console-categories.txt" || true
    echo '```'
  fi
  if [[ -f "$ART_DIR/human-signals.tsv" ]]; then
    echo
    echo "### Human-Readable Session Signals"
    echo
    echo '```text'
    cat "$ART_DIR/human-signals.tsv"
    echo '```'
    echo
    echo '- `content_slides_seen_proxy`: best effort '\''slides seen'\'' count (max of index-based + active-render-based signals).'
    echo '- `message_slides_seen_proxy`: best effort message slide count (max of index-based + impression-based signals).'
    echo '- `content_slide_visits`: index transitions onto content slides.'
    echo '- `message_slide_visits`: index transitions onto injected message slides.'
    echo '- `message_impressions_recorded`: strongest '\''message seen'\'' signal.'
    echo '- `message_pass_through_recorded`: user moved past message slide.'
  fi
  if [[ -f "$ART_DIR/session-story.txt" ]]; then
    echo
    echo "### Session Story"
    echo
    echo '```text'
    cat "$ART_DIR/session-story.txt"
    echo '```'
  fi
  if [[ -s "$ART_DIR/client-debug-config.json" ]]; then
    echo
    echo "### Client Debug Config Snapshot"
    echo
    echo '```json'
    cat "$ART_DIR/client-debug-config.json"
    echo
    echo '```'
  fi
  if [[ "$MODE" = "message" && -f "$ART_DIR/console-mode-message-events.txt" ]]; then
    echo
    echo "### Mode: message (console events top)"
    echo
    echo '```text'
    head -n 20 "$ART_DIR/console-mode-message-events.txt" || true
    echo '```'
  fi
  if [[ "$MODE" = "feed" && -f "$ART_DIR/console-mode-feed-events.txt" ]]; then
    echo
    echo "### Mode: feed (console events top)"
    echo
    echo '```text'
    head -n 30 "$ART_DIR/console-mode-feed-events.txt" || true
    echo '```'
    if [[ -f "$ART_DIR/feed-mode-checks.txt" ]]; then
      echo
      echo "### Mode: feed checks"
      echo
      echo '```text'
      cat "$ART_DIR/feed-mode-checks.txt"
      echo '```'
    fi
  fi
  if [[ "$MODE" = "mixed" && -f "$ART_DIR/console-mode-mixed-events.txt" ]]; then
    echo
    echo "### Mode: mixed (console events top)"
    echo
    echo '```text'
    head -n 30 "$ART_DIR/console-mode-mixed-events.txt" || true
    echo '```'
  fi
  if [[ -f "$ART_DIR/terminal-feed-message-signals.txt" ]]; then
    echo
    echo "### Terminal message signal counts (top)"
    echo
    echo '```text'
    head -n 12 "$ART_DIR/terminal-feed-message-signals.txt" || true
    echo '```'
  fi
  if [[ -f "$ART_DIR/terminal-payment-signals.txt" ]]; then
    echo
    echo "### Terminal payment signal counts (top)"
    echo
    echo '```text'
    head -n 12 "$ART_DIR/terminal-payment-signals.txt" || true
    echo '```'
  fi
  if [[ -f "$ART_DIR/timeline-top.txt" ]]; then
    echo
    echo "### Correlated Timeline (top)"
    echo
    echo '```text'
    head -n 30 "$ART_DIR/timeline-top.txt" || true
    echo '```'
  fi
  echo
  echo "### Interpretation Notes"
  echo
  echo "- \`admin_message_analytics\` can be greater than 1 for a single manual check because page load and Apply/filter submit are separate requests."
  echo "- \`admin_messages\` currently counts \`HTTP GET /admin/messages\` (list/page view). Save actions are reported separately as \`admin_message_save\`."
  echo "- \`payment_checkout_start\` without \`payment_webhook\` is expected when checkout is initiated but provider callback has not occurred yet."
  echo "- \`payment_subscription_action\` counts accepted lifecycle action requests; final status should be confirmed by webhook updates."
} > "$RUN_DIR/summary.md"

echo "debug bundle created:"
echo "  $RUN_DIR"
