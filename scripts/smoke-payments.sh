#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAEGER_TOOL="$ROOT_DIR/scripts/jaeger-query.sh"
LOOKBACK="${1:-30m}"
SERVICE="${DEBUG_BUNDLE_SERVICE:-aws-mediaconvert-service}"
OUT_DIR="$ROOT_DIR/tests/runs/api-curl/payment-smoke-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"

presets=(
  payment_checkout_page
  payment_checkout_start
  payment_webhook
  payment_webhook_ingest
)

{
  echo "preset	trace_count"
  for p in "${presets[@]}"; do
    out="$OUT_DIR/jaeger-${p}.json"
    if "$JAEGER_TOOL" preset "$p" --service "$SERVICE" --lookback "$LOOKBACK" --out "$out" >/dev/null 2>&1; then
      c="$(jq '.data | length' "$out" 2>/dev/null || echo 0)"
      echo -e "${p}\t${c}"
    else
      echo -e "${p}\terror"
    fi
  done
} | tee "$OUT_DIR/counts.tsv"

cat > "$OUT_DIR/notes.txt" <<'TXT'
Manual smoke checklist:
1) Click a provider_checkout CTA in feed (donate/subscribe/upgrade).
2) Confirm /checkout/:intent page loads.
3) Submit checkout provider form.
4) Confirm redirect to PayPal OR mock fallback (if adapter path returns not implemented).
5) For webhook validation, trigger real PayPal sandbox webhook and verify payment_webhook + payment_webhook_ingest counts.
6) Replay the same webhook event and verify webhook trace count increases while completion side effects remain idempotent (no duplicate suppression rows).
TXT

echo "payment smoke artifact directory:"
echo "  $OUT_DIR"
