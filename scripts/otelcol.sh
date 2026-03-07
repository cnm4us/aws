#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OTEL_DIR="$ROOT_DIR/.tmp/otelcol"
BIN_PATH="$OTEL_DIR/otelcol-contrib"
PID_FILE="$OTEL_DIR/otelcol.pid"
LOG_FILE="$ROOT_DIR/logs/otelcol.log"
CONFIG_FILE="${OTELCOL_CONFIG_FILE:-$ROOT_DIR/ops/observability/otelcol.yaml}"
OTELCOL_VERSION="${OTELCOL_VERSION:-0.139.0}"

map_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "darwin" ;;
    *) echo "unsupported" ;;
  esac
}

map_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "unsupported" ;;
  esac
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

install_otelcol() {
  if [[ -x "$BIN_PATH" ]]; then
    return 0
  fi

  local os arch download_url tgz tmp_extract found_bin
  os="$(map_os)"
  arch="$(map_arch)"
  if [[ "$os" == "unsupported" || "$arch" == "unsupported" ]]; then
    echo "Unsupported platform: $(uname -s)/$(uname -m)" >&2
    exit 1
  fi

  mkdir -p "$OTEL_DIR" "$ROOT_DIR/logs"

  download_url="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/otelcol-contrib_${OTELCOL_VERSION}_${os}_${arch}.tar.gz"
  tgz="$OTEL_DIR/otelcol-contrib.tar.gz"
  tmp_extract="$OTEL_DIR/extract"

  rm -rf "$tmp_extract"
  mkdir -p "$tmp_extract"

  echo "Downloading OTel Collector Contrib from: $download_url"
  curl -fL "$download_url" -o "$tgz"
  tar -xzf "$tgz" -C "$tmp_extract"

  found_bin="$(find "$tmp_extract" -type f -name 'otelcol-contrib' | head -n 1 || true)"
  if [[ -z "$found_bin" ]]; then
    echo "otelcol-contrib binary not found in archive." >&2
    exit 1
  fi

  cp "$found_bin" "$BIN_PATH"
  chmod +x "$BIN_PATH"
  rm -rf "$tmp_extract"
}

start_otelcol() {
  if is_running; then
    echo "OTel Collector already running (pid $(cat "$PID_FILE"))"
    echo "Config: $CONFIG_FILE"
    return 0
  fi

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Missing config file: $CONFIG_FILE" >&2
    exit 1
  fi

  install_otelcol
  mkdir -p "$ROOT_DIR/logs"

  setsid "$BIN_PATH" \
    --config "$CONFIG_FILE" \
    >"$LOG_FILE" 2>&1 < /dev/null &

  local pid
  pid="$!"
  echo "$pid" > "$PID_FILE"

  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "OTel Collector started (pid $pid)"
    echo "Config: $CONFIG_FILE"
    return 0
  fi

  echo "OTel Collector failed to start. Recent logs:" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
}

stop_otelcol() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "OTel Collector is not running"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "OTel Collector stopped"
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "OTel Collector force-stopped"
}

status_otelcol() {
  if is_running; then
    echo "OTel Collector running (pid $(cat "$PID_FILE"))"
    echo "Config: $CONFIG_FILE"
  else
    echo "OTel Collector not running"
  fi
}

case "${1:-}" in
  start)
    start_otelcol
    ;;
  stop)
    stop_otelcol
    ;;
  status)
    status_otelcol
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
