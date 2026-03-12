#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

print_help() {
  cat <<'EOF'
Usage:
  npm run admin:backfill-image-derivatives:loop -- [options]

Options:
  --limit <n>            Batch size per run (default: 100)
  --cursor <id>          Start scanning after this upload id (default: 0)
  --sleep-sec <n>        Sleep between batches in seconds (default: 0.5)
  --max-batches <n>      Stop after N batches (default: 0 = no cap)
  --dry 1                Dry run (no enqueue)
  --force 1              Force enqueue even if variants are ready
  --include-system 1     Include system uploads
  --verbose 1            Print full JSON for each batch
  --help                 Show this help

Env defaults (optional):
  BACKFILL_LIMIT
  BACKFILL_CURSOR
  BACKFILL_SLEEP_SEC
  BACKFILL_MAX_BATCHES
  BACKFILL_DRY
  BACKFILL_FORCE
  BACKFILL_INCLUDE_SYSTEM
  BACKFILL_VERBOSE
EOF
}

LIMIT="${BACKFILL_LIMIT:-100}"
CURSOR="${BACKFILL_CURSOR:-0}"
SLEEP_SEC="${BACKFILL_SLEEP_SEC:-0.5}"
MAX_BATCHES="${BACKFILL_MAX_BATCHES:-0}"
DRY="${BACKFILL_DRY:-0}"
FORCE="${BACKFILL_FORCE:-0}"
INCLUDE_SYSTEM="${BACKFILL_INCLUDE_SYSTEM:-0}"
VERBOSE="${BACKFILL_VERBOSE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --cursor)
      CURSOR="${2:-}"
      shift 2
      ;;
    --sleep-sec)
      SLEEP_SEC="${2:-}"
      shift 2
      ;;
    --max-batches)
      MAX_BATCHES="${2:-}"
      shift 2
      ;;
    --dry)
      DRY="${2:-1}"
      shift 2
      ;;
    --force)
      FORCE="${2:-1}"
      shift 2
      ;;
    --include-system)
      INCLUDE_SYSTEM="${2:-1}"
      shift 2
      ;;
    --verbose)
      VERBOSE="${2:-1}"
      shift 2
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      print_help >&2
      exit 2
      ;;
  esac
done

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || (( LIMIT < 1 )) || (( LIMIT > 1000 )); then
  echo "Invalid --limit (1..1000): $LIMIT" >&2
  exit 2
fi
if ! [[ "$CURSOR" =~ ^[0-9]+$ ]]; then
  echo "Invalid --cursor (>=0): $CURSOR" >&2
  exit 2
fi
if ! [[ "$MAX_BATCHES" =~ ^[0-9]+$ ]]; then
  echo "Invalid --max-batches (>=0): $MAX_BATCHES" >&2
  exit 2
fi

batch_no=0
total_rows=0
total_enqueued=0
total_skip_ready=0
total_skip_pending=0
total_skip_invalid=0

echo "[backfill:image-derivatives] start limit=$LIMIT cursor=$CURSOR dry=$DRY force=$FORCE include_system=$INCLUDE_SYSTEM sleep_sec=$SLEEP_SEC max_batches=$MAX_BATCHES"

while true; do
  batch_no=$((batch_no + 1))

  output="$(cd "$ROOT_DIR" && npm run -s admin:backfill-image-derivatives -- --limit "$LIMIT" --cursor "$CURSOR" --dry "$DRY" --force "$FORCE" --include-system "$INCLUDE_SYSTEM")"

  if [[ "$VERBOSE" == "1" ]]; then
    echo "$output"
  fi

  meta="$(printf '%s' "$output" | node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const s=d.summary||{}; console.log([Number(d.count||0),Number(d.nextCursor||0),Number(s.enqueued||0),Number(s.skippedReady||0),Number(s.skippedPending||0),Number(s.skippedInvalid||0)].join('\t'));")"
  IFS=$'\t' read -r count next_cursor enq skip_ready skip_pending skip_invalid <<< "$meta"

  total_rows=$((total_rows + count))
  total_enqueued=$((total_enqueued + enq))
  total_skip_ready=$((total_skip_ready + skip_ready))
  total_skip_pending=$((total_skip_pending + skip_pending))
  total_skip_invalid=$((total_skip_invalid + skip_invalid))

  echo "[backfill:image-derivatives] batch=$batch_no cursor=$CURSOR rows=$count enqueued=$enq skip_ready=$skip_ready skip_pending=$skip_pending skip_invalid=$skip_invalid next_cursor=$next_cursor"

  if (( count == 0 )); then
    echo "[backfill:image-derivatives] complete (no more rows)"
    break
  fi

  if (( next_cursor <= CURSOR )); then
    echo "[backfill:image-derivatives] stopping: next_cursor ($next_cursor) <= cursor ($CURSOR) to avoid loop"
    break
  fi

  CURSOR="$next_cursor"

  if (( MAX_BATCHES > 0 && batch_no >= MAX_BATCHES )); then
    echo "[backfill:image-derivatives] reached max_batches=$MAX_BATCHES"
    break
  fi

  if [[ "$SLEEP_SEC" != "0" ]]; then
    sleep "$SLEEP_SEC"
  fi
done

echo "[backfill:image-derivatives] summary batches=$batch_no total_rows=$total_rows total_enqueued=$total_enqueued total_skip_ready=$total_skip_ready total_skip_pending=$total_skip_pending total_skip_invalid=$total_skip_invalid final_cursor=$CURSOR"
