#!/usr/bin/env bash
set -euo pipefail

# Usage:
# submit_hls_job.sh portrait ASSET_ID s3://bacs-mc-uploads/path/file.mp4
# submit_hls_job.sh landscape ASSET_ID s3://bacs-mc-uploads/path/file.mp4

if [[ $# -ne 3 ]]; then
  echo "Usage: $(basename "$0") <portrait|landscape> <ASSET_ID> <INPUT_URI>" >&2
  exit 1
fi

ORIENT="$1"
ASSET_ID="$2"
INPUT_URI="$3"

case "$ORIENT" in
  portrait)
    tpl="job-portrait-hls.json"
    ;;
  landscape)
    tpl="job-landscape-both-hls.json"
    ;;
  *)
    echo "First arg must be 'portrait' or 'landscape'" >&2
    exit 2
    ;;
esac

tmp="/tmp/${tpl%.json}.${ASSET_ID}.json"
sed -e "s|ASSET_ID|${ASSET_ID}|g" -e "s|INPUT_URI|${INPUT_URI}|g" "$tpl" > "$tmp"

JOB_ID=$(aws mediaconvert create-job \
  --region us-west-1 \
  --endpoint-url https://mediaconvert.us-west-1.amazonaws.com \
  --role arn:aws:iam::476164121264:role/MediaConvertJobRole \
  --settings file://"$tmp" \
  --no-cli-pager \
  --query 'Job.Id' --output text)

echo "$JOB_ID"

