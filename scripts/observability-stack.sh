#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

start_stack() {
  echo "[obs] starting jaeger"
  bash "$ROOT_DIR/scripts/jaeger.sh" start
  echo "[obs] starting prometheus"
  bash "$ROOT_DIR/scripts/prometheus.sh" start
  echo "[obs] starting otel collector"
  bash "$ROOT_DIR/scripts/otelcol.sh" start
}

stop_stack() {
  echo "[obs] stopping otel collector"
  bash "$ROOT_DIR/scripts/otelcol.sh" stop || true
  echo "[obs] stopping prometheus"
  bash "$ROOT_DIR/scripts/prometheus.sh" stop || true
  echo "[obs] stopping jaeger"
  bash "$ROOT_DIR/scripts/jaeger.sh" stop || true
}

status_stack() {
  echo "[obs] jaeger"
  bash "$ROOT_DIR/scripts/jaeger.sh" status
  echo
  echo "[obs] prometheus"
  bash "$ROOT_DIR/scripts/prometheus.sh" status
  echo
  echo "[obs] otel collector"
  bash "$ROOT_DIR/scripts/otelcol.sh" status
}

logs_stack() {
  echo "[obs] tailing logs (jaeger/prometheus/otelcol)"
  tail -n 120 "$ROOT_DIR/logs/jaeger.log" "$ROOT_DIR/logs/prometheus.log" "$ROOT_DIR/logs/otelcol.log"
}

case "${1:-}" in
  start)
    start_stack
    ;;
  stop)
    stop_stack
    ;;
  status)
    status_stack
    ;;
  logs)
    logs_stack
    ;;
  *)
    echo "Usage: $0 {start|stop|status|logs}" >&2
    exit 1
    ;;
esac
