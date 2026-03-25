#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-sandbox}"

echo "Step 1/2: Cancel PayPal subscriptions from local state (mode=${MODE})..."
npm run payments:paypal:cleanup-subscriptions -- --mode "${MODE}" || true

echo
echo "Step 2/2: Clear local payment state..."
npm run payments:reset:local

echo
echo "Done."
echo "Tip: run diagnostics after new tests:"
echo "  npm run db:query:subscriptions"
echo "  npm run db:query:donations"

