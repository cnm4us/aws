#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAEGER_DIR="$ROOT_DIR/.tmp/jaeger"
BIN_PATH="$JAEGER_DIR/jaeger-all-in-one"
PID_FILE="$JAEGER_DIR/jaeger.pid"
LOG_FILE="$ROOT_DIR/logs/jaeger.log"
JAEGER_VERSION="${JAEGER_VERSION:-1.62.0}"

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

install_jaeger() {
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

  mkdir -p "$JAEGER_DIR" "$ROOT_DIR/logs"

  if ! [[ "$JAEGER_VERSION" =~ ^1\. ]]; then
    echo "This helper currently supports Jaeger 1.x. Set JAEGER_VERSION=1.x (current: $JAEGER_VERSION)." >&2
    exit 1
  fi
  download_url="https://github.com/jaegertracing/jaeger/releases/download/v${JAEGER_VERSION}/jaeger-${JAEGER_VERSION}-${os}-${arch}.tar.gz"

  tgz="$JAEGER_DIR/jaeger.tar.gz"
  tmp_extract="$JAEGER_DIR/extract"
  rm -rf "$tmp_extract"
  mkdir -p "$tmp_extract"

  echo "Downloading Jaeger from: $download_url"
  curl -fL "$download_url" -o "$tgz"
  tar -xzf "$tgz" -C "$tmp_extract"

  found_bin="$(find "$tmp_extract" -type f -name 'jaeger-all-in-one' | head -n 1 || true)"
  if [[ -z "$found_bin" ]]; then
    echo "Jaeger all-in-one binary not found. Confirm JAEGER_VERSION points to a 1.x release." >&2
    exit 1
  fi

  cp "$found_bin" "$BIN_PATH"
  chmod +x "$BIN_PATH"
  rm -rf "$tmp_extract"
}

start_jaeger() {
  if is_running; then
    echo "Jaeger already running (pid $(cat "$PID_FILE"))"
    echo "UI: http://localhost:16686"
    return 0
  fi

  install_jaeger
  mkdir -p "$ROOT_DIR/logs"

  setsid "$BIN_PATH" \
    --collector.otlp.enabled=true \
    --collector.otlp.grpc.host-port=0.0.0.0:4317 \
    --collector.otlp.http.host-port=0.0.0.0:4318 \
    >"$LOG_FILE" 2>&1 < /dev/null &

  local pid
  pid="$!"
  echo "$pid" > "$PID_FILE"

  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "Jaeger started (pid $pid)"
    echo "UI: http://localhost:16686"
    echo "OTLP HTTP endpoint: http://localhost:4318"
    return 0
  fi

  echo "Jaeger failed to start. Recent logs:" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
}

stop_jaeger() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Jaeger is not running"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Jaeger stopped"
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Jaeger force-stopped"
}

status_jaeger() {
  if is_running; then
    echo "Jaeger running (pid $(cat "$PID_FILE"))"
    echo "UI: http://localhost:16686"
    echo "OTLP HTTP endpoint: http://localhost:4318"
  else
    echo "Jaeger not running"
  fi
}

case "${1:-}" in
  start)
    start_jaeger
    ;;
  stop)
    stop_jaeger
    ;;
  status)
    status_jaeger
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
