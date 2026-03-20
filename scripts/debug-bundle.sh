#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOOKBACK="${DEBUG_BUNDLE_LOOKBACK:-1h}"
SERVICE="${DEBUG_BUNDLE_SERVICE:-aws-mediaconvert-service}"
DEST_ROOT="$ROOT_DIR/tests/runs/api-curl"
RUN_ID=""

usage() {
  cat <<'USAGE'
Usage:
  debug-bundle.sh [--run-id <id>] [--lookback <window>] [--service <name>] [--dest-root <dir>]

Examples:
  npm run debug:bundle
  npm run debug:bundle -- --lookback 15m
  npm run debug:bundle -- --run-id 2026-03-20_message-stuck --lookback 2h
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --lookback) LOOKBACK="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --dest-root) DEST_ROOT="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "error: unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="debug-bundle-$(date -u +%Y%m%dT%H%M%SZ)"
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
  f="$(ls -1t "$dir" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$f" ]]; then
    return 1
  fi
  printf '%s\n' "$f"
}

TERMINAL_SRC=""
CONSOLE_SRC=""

if TERMINAL_SRC="$(latest_file "$ROOT_DIR/debug/terminal/*")"; then
  cp "$TERMINAL_SRC" "$ART_DIR/terminal-latest.log"
fi

if CONSOLE_SRC="$(latest_file "$ROOT_DIR/debug/console/*")"; then
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

{
  printf "preset\ttrace_count\n"
  for p in "${PRESETS[@]}"; do
    out="$ART_DIR/jaeger-${p}.json"
    if "$JAEGER_TOOL" preset "$p" --service "$SERVICE" --lookback "$LOOKBACK" --out "$out" >/dev/null 2>&1; then
      c="$(jq '.data | length' "$out" 2>/dev/null || echo "0")"
      printf "%s\t%s\n" "$p" "$c"
    else
      printf "%s\t%s\n" "$p" "error"
    fi
  done
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

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "# Debug Bundle"
  echo
  echo "- Run ID: \`$RUN_ID\`"
  echo "- Captured at (UTC): \`$now_iso\`"
  echo "- Service: \`$SERVICE\`"
  echo "- Jaeger lookback: \`$LOOKBACK\`"
  echo
  echo "## Sources"
  echo "- Latest terminal log: \`${TERMINAL_SRC:-not_found}\`"
  echo "- Latest browser console log: \`${CONSOLE_SRC:-not_found}\`"
  echo
  echo "## Artifacts"
  echo "- \`artifacts/terminal-latest.log\`"
  echo "- \`artifacts/console-latest.ndjson\`"
  echo "- \`artifacts/jaeger-counts.tsv\`"
  echo "- \`artifacts/jaeger-message_decide.json\`"
  echo "- \`artifacts/jaeger-message_fetch.json\`"
  echo "- \`artifacts/jaeger-message_event.json\`"
  echo "- \`artifacts/jaeger-admin_messages.json\`"
  echo "- \`artifacts/jaeger-admin_message_analytics.json\`"
  echo "- \`artifacts/jaeger-message-event-tags.txt\`"
  echo "- \`artifacts/console-categories.txt\`"
  echo "- \`artifacts/console-events.txt\`"
  echo "- \`artifacts/terminal-feed-message-signals.txt\`"
  echo
  echo "## Quick Assessment"
  echo
  echo "### Jaeger trace counts"
  echo
  echo '```text'
  cat "$ART_DIR/jaeger-counts.tsv"
  echo '```'
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
} > "$RUN_DIR/summary.md"

echo "debug bundle created:"
echo "  $RUN_DIR"
