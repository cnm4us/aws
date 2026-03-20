#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOOKBACK="${DEBUG_BUNDLE_LOOKBACK:-1h}"
SERVICE="${DEBUG_BUNDLE_SERVICE:-aws-mediaconvert-service}"
DEST_ROOT="$ROOT_DIR/tests/runs/api-curl"
RUN_ID=""
BASE_NAME="debug-bundle"

usage() {
  cat <<'USAGE'
Usage:
  debug-bundle.sh [--run-id <id>] [--base-name <name>] [--lookback <window>] [--service <name>] [--dest-root <dir>]

Examples:
  npm run debug:bundle
  npm run debug:bundle -- --lookback 15m
  npm run debug:bundle -- --run-id 2026-03-20_message-stuck --lookback 2h
  npm run debug:bundle -- --base-name message-bundle --lookback 30m
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --base-name) BASE_NAME="${2:-}"; shift 2 ;;
    --lookback) LOOKBACK="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --dest-root) DEST_ROOT="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

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
  "admin_message_analytics"
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

if [[ -f "$ART_DIR/console-latest.ndjson" ]]; then
  jq -Rr 'fromjson? | .category // empty' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-categories.txt" || true
  jq -Rr 'fromjson? | .event // empty' "$ART_DIR/console-latest.ndjson" | sort | uniq -c | sort -nr > "$ART_DIR/console-events.txt" || true
fi

if [[ -f "$ART_DIR/terminal-latest.log" ]]; then
  rg -o 'feed\.message\.[a-z_]+' "$ART_DIR/terminal-latest.log" | sort | uniq -c | sort -nr > "$ART_DIR/terminal-feed-message-signals.txt" || true
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

python3 "$ROOT_DIR/scripts/build-debug-timeline.py" \
  --artifacts-dir "$ART_DIR" \
  --window-start-iso "$window_start_iso" \
  --window-end-iso "$window_end_iso" >/dev/null 2>&1 || true

now_iso="$window_end_iso"
{
  echo "# Debug Bundle"
  echo
  echo "- Run ID: \`$RUN_ID\`"
  echo "- Captured at (UTC): \`$now_iso\`"
  echo "- Service: \`$SERVICE\`"
  echo "- Jaeger lookback: \`$LOOKBACK\`"
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
  echo "- \`artifacts/jaeger-message_decide.json\`"
  echo "- \`artifacts/jaeger-message_fetch.json\`"
  echo "- \`artifacts/jaeger-message_event.json\`"
  echo "- \`artifacts/jaeger-admin_messages.json\`"
  echo "- \`artifacts/jaeger-admin_message_analytics.json\`"
  echo "- \`artifacts/jaeger-message-event-tags.txt\`"
  echo "- \`artifacts/console-categories.txt\`"
  echo "- \`artifacts/console-events.txt\`"
  echo "- \`artifacts/terminal-feed-message-signals.txt\`"
  echo "- \`artifacts/timeline.ndjson\`"
  echo "- \`artifacts/timeline-top.txt\`"
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
  if [[ -f "$ART_DIR/console-categories.txt" ]]; then
    echo
    echo "### Console category counts (top)"
    echo
    echo '```text'
    head -n 12 "$ART_DIR/console-categories.txt" || true
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
  echo "- \`admin_messages\` currently counts \`HTTP GET /admin/messages\` (list/page view). Save actions are \`POST /admin/messages/:id\` and are not included in that row."
} > "$RUN_DIR/summary.md"

echo "debug bundle created:"
echo "  $RUN_DIR"
