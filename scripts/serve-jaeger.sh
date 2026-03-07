#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${JAEGER_ENV_FILE:-$ROOT_DIR/.env.jaeger}"
EXAMPLE_FILE="$ROOT_DIR/.env.jaeger.example"

if [[ -f "$ENV_FILE" ]]; then
  echo "[serve:jaeger] using env file: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [[ -f "$EXAMPLE_FILE" ]]; then
  echo "[serve:jaeger] using fallback env file: $EXAMPLE_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$EXAMPLE_FILE"
  set +a
else
  echo "[serve:jaeger] missing env file. Create .env.jaeger or .env.jaeger.example" >&2
  exit 1
fi

if [[ "${OTEL_ENABLED:-0}" == "1" ]]; then
  current_endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-}"
  if [[ "$current_endpoint" == "http://127.0.0.1:4318" || "$current_endpoint" == "http://localhost:4318" ]]; then
    echo "[serve:jaeger] warning: OTEL_EXPORTER_OTLP_ENDPOINT is set to Jaeger direct ($current_endpoint)." >&2
    echo "[serve:jaeger] for SPM, point app telemetry to OTel Collector: http://127.0.0.1:5318" >&2
  fi
fi

exec npm run serve
