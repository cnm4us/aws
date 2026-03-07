#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROM_DIR="$ROOT_DIR/.tmp/prometheus"
BIN_PATH="$PROM_DIR/prometheus"
PID_FILE="$PROM_DIR/prometheus.pid"
LOG_FILE="$ROOT_DIR/logs/prometheus.log"
CONFIG_FILE="${PROM_CONFIG_FILE:-$ROOT_DIR/ops/observability/prometheus.yml}"
PROM_VERSION="${PROM_VERSION:-2.55.1}"
PROM_RETENTION_TIME="${PROM_RETENTION_TIME:-48h}"
PROM_RETENTION_SIZE="${PROM_RETENTION_SIZE:-2GB}"
PROM_LISTEN_ADDRESS="${PROM_LISTEN_ADDRESS:-127.0.0.1:9090}"
PROM_DATA_DIR="$PROM_DIR/data"

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

install_prometheus() {
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

  mkdir -p "$PROM_DIR" "$ROOT_DIR/logs"

  download_url="https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}/prometheus-${PROM_VERSION}.${os}-${arch}.tar.gz"
  tgz="$PROM_DIR/prometheus.tar.gz"
  tmp_extract="$PROM_DIR/extract"

  rm -rf "$tmp_extract"
  mkdir -p "$tmp_extract"

  echo "Downloading Prometheus from: $download_url"
  curl -fL "$download_url" -o "$tgz"
  tar -xzf "$tgz" -C "$tmp_extract"

  found_bin="$(find "$tmp_extract" -type f -name 'prometheus' | head -n 1 || true)"
  if [[ -z "$found_bin" ]]; then
    echo "Prometheus binary not found in archive." >&2
    exit 1
  fi

  cp "$found_bin" "$BIN_PATH"
  chmod +x "$BIN_PATH"
  rm -rf "$tmp_extract"
}

start_prometheus() {
  if is_running; then
    echo "Prometheus already running (pid $(cat "$PID_FILE"))"
    echo "UI: http://${PROM_LISTEN_ADDRESS}"
    return 0
  fi

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Missing config file: $CONFIG_FILE" >&2
    exit 1
  fi

  install_prometheus
  mkdir -p "$ROOT_DIR/logs" "$PROM_DATA_DIR"

  setsid "$BIN_PATH" \
    --config.file="$CONFIG_FILE" \
    --storage.tsdb.path="$PROM_DATA_DIR" \
    --storage.tsdb.retention.time="$PROM_RETENTION_TIME" \
    --storage.tsdb.retention.size="$PROM_RETENTION_SIZE" \
    --storage.tsdb.wal-compression \
    --web.listen-address="$PROM_LISTEN_ADDRESS" \
    >"$LOG_FILE" 2>&1 < /dev/null &

  local pid
  pid="$!"
  echo "$pid" > "$PID_FILE"

  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "Prometheus started (pid $pid)"
    echo "UI: http://${PROM_LISTEN_ADDRESS}"
    echo "Config: $CONFIG_FILE"
    echo "Retention: time=${PROM_RETENTION_TIME}, size=${PROM_RETENTION_SIZE}"
    return 0
  fi

  echo "Prometheus failed to start. Recent logs:" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
}

stop_prometheus() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Prometheus is not running"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "Prometheus stopped"
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Prometheus force-stopped"
}

status_prometheus() {
  if is_running; then
    echo "Prometheus running (pid $(cat "$PID_FILE"))"
    echo "UI: http://${PROM_LISTEN_ADDRESS}"
    echo "Config: $CONFIG_FILE"
    echo "Retention: time=${PROM_RETENTION_TIME}, size=${PROM_RETENTION_SIZE}"
  else
    echo "Prometheus not running"
  fi
}

case "${1:-}" in
  start)
    start_prometheus
    ;;
  stop)
    stop_prometheus
    ;;
  status)
    status_prometheus
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
