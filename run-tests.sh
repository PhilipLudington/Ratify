#!/usr/bin/env bash
# AirTower test wrapper. Runs the suite and records the outcome in
# .test-results.json so the badge reflects reality.
#
# Always run tests through this script, never `npm test` directly.

set -uo pipefail
cd "$(dirname "$0")"

REPORT=".vitest-report.json"
RESULTS=".test-results.json"

rm -f "$REPORT"

npx vitest run --reporter=default --reporter=json --outputFile.json="$REPORT"
STATUS=$?

node scripts/airtower-results.mjs tests "$REPORT" "$RESULTS" "$STATUS"
rm -f "$REPORT"

exit $STATUS
