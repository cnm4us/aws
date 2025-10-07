#!/usr/bin/env bash
set -euo pipefail

# Usage: archive_original.sh s3://source-bucket/path/to/file.ext ASSET_ID
# Copies the original uploaded object to bacs-mc-transcoded/ASSET_ID/original.ext

if [[ $# -ne 2 ]]; then
  echo "Usage: $(basename "$0") s3://source-bucket/key ASSET_ID" >&2
  exit 1
fi

SRC_URI="$1"
ASSET_ID="$2"

ext="${SRC_URI##*.}"
dest="s3://bacs-mc-transcoded/${ASSET_ID}/original.${ext}"

echo "Copying original to: ${dest}"
aws s3 cp "${SRC_URI}" "${dest}"
echo "Done."

