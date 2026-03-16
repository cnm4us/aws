#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "" ]]; then
  mkdir -p "$ROOT_DIR/debug/terminal"
  LOG_FILE="$ROOT_DIR/debug/terminal/serve-jaeger-$(date -u +%Y%m%dT%H%M%SZ).txt"
else
  LOG_FILE="$1"
  if [[ "$LOG_FILE" != /* ]]; then
    LOG_FILE="$ROOT_DIR/$LOG_FILE"
  fi
fi

LOG_DIR="$(dirname "$LOG_FILE")"
mkdir -p "$LOG_DIR"

echo "[serve:jaeger:log] writing combined output to: $LOG_FILE"

# Keep ANSI colors in the live terminal stream, but strip them from the file
# so the saved log is readable in editors and plain text tools. Force autoflush
# so the file updates while the server is still running.
bash "$ROOT_DIR/scripts/serve-jaeger.sh" 2>&1 | tee >(perl -ne 'BEGIN { $| = 1 } s/\e\[[0-9;]*[[:alpha:]]//g; print' > "$LOG_FILE")
