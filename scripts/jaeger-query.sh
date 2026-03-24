#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${JAEGER_BASE_URL:-http://127.0.0.1:16686}"
DEFAULT_SERVICE="${JAEGER_DEFAULT_SERVICE:-aws-mediaconvert-service}"
CMD="${1:-}"
if [[ -z "$CMD" ]]; then
  CMD="help"
fi
shift || true

SERVICE=""
OPERATION=""
TRACE_ID=""
LOOKBACK="1h"
LIMIT="20"
START=""
END=""
MIN_DURATION=""
MAX_DURATION=""
OUT_FILE=""
SUMMARY="0"
TAGS=()

usage() {
  cat <<'USAGE'
Usage:
  jaeger-query.sh services
  jaeger-query.sh operations --service <service>
  jaeger-query.sh traces [--service <service>] [--operation <name>] [--tag k=v ...] [--lookback 15m|1h|2h|1d] [--limit N] [--start <micros>] [--end <micros>] [--summary] [--out <file>]
  jaeger-query.sh trace --trace-id <id> [--summary] [--out <file>]
  jaeger-query.sh preset <name> [--lookback ...] [--limit ...] [--summary] [--out <file>]

Presets:
  message_decide           app.operation=feed.message.decide
  message_fetch            app.operation=feed.message.fetch
  message_event            app.operation=feed.message.event
  admin_messages           HTTP GET /admin/messages
  admin_message_save       HTTP POST /admin/messages/:id
  admin_message_analytics  HTTP GET /admin/message-analytics
  payment_checkout_page    HTTP GET /checkout/:intent
  payment_checkout_start   app.operation=payments.checkout.start
  payment_webhook          app.operation=payments.webhook
  payment_webhook_ingest   app.operation=payments.webhook.ingest
  support_page             HTTP GET /support
  my_support_view          HTTP GET /my/support
  payment_subscription_action app.operation=payments.subscription.action
  feed_message_pipeline    Runs message_decide/message_fetch/message_event checks in sequence.
  payment_pipeline         Runs payment checkout and webhook checks in sequence.
  support_pipeline         Runs support/payment lifecycle checks in sequence.

Examples:
  npm run jaeger:query -- services
  npm run jaeger:query -- operations --service aws-mediaconvert-service
  npm run jaeger:query -- traces --service aws-mediaconvert-service --operation "POST /api/feed/message-decision" --tag app.operation=feed.message.decide --lookback 15m --summary
  npm run jaeger:query -- preset feed_message_pipeline --service aws-mediaconvert-service --lookback 15m --summary
USAGE
}

die() {
  echo "error: $*" >&2
  exit 1
}

has() {
  command -v "$1" >/dev/null 2>&1
}

parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-url) BASE_URL="${2:-}"; shift 2 ;;
      --service) SERVICE="${2:-}"; shift 2 ;;
      --operation) OPERATION="${2:-}"; shift 2 ;;
      --trace-id) TRACE_ID="${2:-}"; shift 2 ;;
      --lookback) LOOKBACK="${2:-}"; shift 2 ;;
      --limit) LIMIT="${2:-}"; shift 2 ;;
      --start) START="${2:-}"; shift 2 ;;
      --end) END="${2:-}"; shift 2 ;;
      --min-duration) MIN_DURATION="${2:-}"; shift 2 ;;
      --max-duration) MAX_DURATION="${2:-}"; shift 2 ;;
      --tag) TAGS+=("${2:-}"); shift 2 ;;
      --out) OUT_FILE="${2:-}"; shift 2 ;;
      --summary) SUMMARY="1"; shift 1 ;;
      --help|-h) usage; exit 0 ;;
      *) die "unknown arg: $1" ;;
    esac
  done
}

write_output() {
  local payload="$1"
  if [[ -n "$OUT_FILE" ]]; then
    mkdir -p "$(dirname "$OUT_FILE")"
    printf '%s\n' "$payload" > "$OUT_FILE"
    echo "wrote: $OUT_FILE" >&2
  fi
}

curl_json() {
  curl -fsS "$@"
}

build_tags_json() {
  if [[ ${#TAGS[@]} -eq 0 ]]; then
    echo '{}'
    return 0
  fi
  printf '%s\n' "${TAGS[@]}" \
    | jq -Rn '
        [inputs | select(length > 0) | split("=") | {(.[0]): (.[1:] | join("="))}]
        | add // {}
      '
}

print_services_summary() {
  local json="$1"
  local count
  count="$(printf '%s\n' "$json" | jq '.data | length')"
  echo "services: $count"
  printf '%s\n' "$json" | jq -r '.data[]'
}

print_operations_summary() {
  local json="$1"
  local count
  count="$(printf '%s\n' "$json" | jq '.data | length')"
  echo "operations: $count"
  printf '%s\n' "$json" | jq -r '.data[] | "\(.name)\t(spanKind=\(.spanKind // "?"))"'
}

print_traces_summary() {
  local json="$1"
  local count
  count="$(printf '%s\n' "$json" | jq '.data | length')"
  echo "traces: $count"
  if [[ "$count" == "0" ]]; then
    return 0
  fi
  echo "top operations:"
  printf '%s\n' "$json" | jq -r '
    [.data[].spans[].operationName]
    | group_by(.)
    | map({op: .[0], n: length})
    | sort_by(-.n, .op)
    | .[:10]
    | .[] | "  \(.n)\t\(.op)"
  '
  echo "trace ids:"
  printf '%s\n' "$json" | jq -r '.data[:20][] | "  \(.traceID)"'
}

run_services() {
  local json
  json="$(curl_json "$BASE_URL/api/services")"
  write_output "$json"
  if [[ "$SUMMARY" == "1" ]]; then
    print_services_summary "$json"
  else
    printf '%s\n' "$json" | jq .
  fi
}

run_operations() {
  [[ -n "$SERVICE" ]] || die "--service is required for operations"
  local json
  json="$(curl_json -G "$BASE_URL/api/operations" --data-urlencode "service=$SERVICE")"
  write_output "$json"
  if [[ "$SUMMARY" == "1" ]]; then
    print_operations_summary "$json"
  else
    printf '%s\n' "$json" | jq .
  fi
}

run_traces() {
  if [[ -z "$SERVICE" ]]; then
    SERVICE="$DEFAULT_SERVICE"
  fi
  local tags_json
  tags_json="$(build_tags_json)"

  local curl_args=(
    -G "$BASE_URL/api/traces"
    --data-urlencode "lookback=$LOOKBACK"
    --data-urlencode "limit=$LIMIT"
    --data-urlencode "tags=$tags_json"
    --data-urlencode "service=$SERVICE"
  )
  if [[ -n "$OPERATION" ]]; then curl_args+=(--data-urlencode "operation=$OPERATION"); fi
  if [[ -n "$START" ]]; then curl_args+=(--data-urlencode "start=$START"); fi
  if [[ -n "$END" ]]; then curl_args+=(--data-urlencode "end=$END"); fi
  if [[ -n "$MIN_DURATION" ]]; then curl_args+=(--data-urlencode "minDuration=$MIN_DURATION"); fi
  if [[ -n "$MAX_DURATION" ]]; then curl_args+=(--data-urlencode "maxDuration=$MAX_DURATION"); fi

  local json
  json="$(curl_json "${curl_args[@]}")"
  write_output "$json"
  if [[ "$SUMMARY" == "1" ]]; then
    print_traces_summary "$json"
  else
    printf '%s\n' "$json" | jq .
  fi
}

run_trace() {
  [[ -n "$TRACE_ID" ]] || die "--trace-id is required for trace"
  local json
  json="$(curl_json "$BASE_URL/api/traces/$TRACE_ID")"
  write_output "$json"
  if [[ "$SUMMARY" == "1" ]]; then
    echo "trace id: $TRACE_ID"
    printf '%s\n' "$json" | jq -r '
      .data[0] as $t
      | "spans: \($t.spans | length)\noperations:\n" +
        (([$t.spans[].operationName] | group_by(.) | map({op: .[0], n: length}) | sort_by(-.n, .op))
          | map("  \(.n)\t\(.op)") | join("\n"))
    '
  else
    printf '%s\n' "$json" | jq .
  fi
}

run_preset_once() {
  local name="$1"
  local op=""
  local tag=""
  case "$name" in
    message_decide)
      tag="app.operation=feed.message.decide"
      ;;
    message_fetch)
      tag="app.operation=feed.message.fetch"
      ;;
    message_event)
      tag="app.operation=feed.message.event"
      ;;
    admin_messages)
      op="HTTP GET /admin/messages"
      ;;
    admin_message_save)
      op="HTTP POST /admin/messages/:id"
      ;;
    admin_message_analytics)
      op="HTTP GET /admin/message-analytics"
      ;;
    payment_checkout_page)
      op="HTTP GET /checkout/:intent"
      ;;
    payment_checkout_start)
      tag="app.operation=payments.checkout.start"
      ;;
    payment_webhook)
      tag="app.operation=payments.webhook"
      ;;
    payment_webhook_ingest)
      tag="app.operation=payments.webhook.ingest"
      ;;
    support_page)
      op="HTTP GET /support"
      ;;
    my_support_view)
      op="HTTP GET /my/support"
      ;;
    payment_subscription_action)
      tag="app.operation=payments.subscription.action"
      ;;
    *)
      die "unknown preset: $name"
      ;;
  esac

  local old_operation="$OPERATION"
  local old_tags=("${TAGS[@]}")
  OPERATION="$op"
  if [[ -n "$tag" ]]; then
    TAGS=("$tag")
  else
    TAGS=()
  fi
  run_traces
  OPERATION="$old_operation"
  TAGS=("${old_tags[@]}")
}

run_preset() {
  local name="$1"
  if [[ -z "$SERVICE" ]]; then
    SERVICE="$DEFAULT_SERVICE"
  fi
  if [[ "$name" == "feed_message_pipeline" ]]; then
    local names=("message_decide" "message_fetch" "message_event")
    for n in "${names[@]}"; do
      echo "== preset: $n =="
      local old_out="$OUT_FILE"
      if [[ -n "$OUT_FILE" ]]; then
        local ext=""
        if [[ "$OUT_FILE" == *.* ]]; then
          ext=".${OUT_FILE##*.}"
          OUT_FILE="${OUT_FILE%.*}"
        fi
        OUT_FILE="${OUT_FILE}-${n}${ext}"
      fi
      run_preset_once "$n"
      OUT_FILE="$old_out"
      echo
    done
    return 0
  fi
  if [[ "$name" == "payment_pipeline" ]]; then
    local names=("payment_checkout_page" "payment_checkout_start" "payment_webhook" "payment_webhook_ingest" "payment_subscription_action")
    for n in "${names[@]}"; do
      echo "== preset: $n =="
      local old_out="$OUT_FILE"
      if [[ -n "$OUT_FILE" ]]; then
        local ext=""
        if [[ "$OUT_FILE" == *.* ]]; then
          ext=".${OUT_FILE##*.}"
          OUT_FILE="${OUT_FILE%.*}"
        fi
        OUT_FILE="${OUT_FILE}-${n}${ext}"
      fi
      run_preset_once "$n"
      OUT_FILE="$old_out"
      echo
    done
    return 0
  fi
  if [[ "$name" == "support_pipeline" ]]; then
    local names=("support_page" "payment_checkout_page" "payment_checkout_start" "payment_webhook" "payment_webhook_ingest" "my_support_view" "payment_subscription_action")
    for n in "${names[@]}"; do
      echo "== preset: $n =="
      local old_out="$OUT_FILE"
      if [[ -n "$OUT_FILE" ]]; then
        local ext=""
        if [[ "$OUT_FILE" == *.* ]]; then
          ext=".${OUT_FILE##*.}"
          OUT_FILE="${OUT_FILE%.*}"
        fi
        OUT_FILE="${OUT_FILE}-${n}${ext}"
      fi
      run_preset_once "$n"
      OUT_FILE="$old_out"
      echo
    done
    return 0
  fi
  run_preset_once "$name"
}

main() {
  has curl || die "curl is required"
  has jq || die "jq is required"

  case "$CMD" in
    services)
      parse_common_args "$@"
      run_services
      ;;
    operations)
      parse_common_args "$@"
      run_operations
      ;;
    traces)
      parse_common_args "$@"
      run_traces
      ;;
    trace)
      parse_common_args "$@"
      run_trace
      ;;
    preset)
      local preset_name="${1:-}"
      [[ -n "$preset_name" ]] || die "preset name is required"
      shift || true
      parse_common_args "$@"
      run_preset "$preset_name"
      ;;
    help|--help|-h)
      usage
      ;;
    *)
      die "unknown command: $CMD"
      ;;
  esac
}

main "$@"
