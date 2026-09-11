#!/usr/bin/env bash
# AirTower build wrapper. Type-checks each of the codebase's three typed
# surfaces — worker, client, and the script tests — builds the client, and
# dry-runs the Durable Object Worker bundle, recording the outcome in
# .build-results.json.
#
# The dry run matters: the DO Worker is never exercised by `vite build`, so
# without it a broken wrangler.log.toml or a bad import would not surface until
# deploy time.
#
# Always build through this script, never `npm run build` directly.

set -uo pipefail
cd "$(dirname "$0")"

LOG="$(mktemp -t ratify-build)"
RESULTS=".build-results.json"

{
  echo "== generate: Cloudflare Env types from wrangler.log.toml =="
  npx wrangler types -c wrangler.log.toml || exit 1

  echo "== typecheck: worker, durable object, functions, tests =="
  npx tsc -p tsconfig.json --noEmit || exit 1

  echo "== typecheck: client =="
  npx tsc -p tsconfig.client.json --noEmit || exit 1

  echo "== typecheck: script tests =="
  npx tsc -p tsconfig.scripts.json --noEmit || exit 1

  echo "== build: client -> dist =="
  npx vite build || exit 1

  echo "== bundle check: ratify-log worker =="
  npx wrangler deploy -c wrangler.log.toml --dry-run --outdir .wrangler/dry-run || exit 1
} 2>&1 | tee "$LOG"

STATUS=${PIPESTATUS[0]}

node scripts/airtower-results.mjs build "$LOG" "$RESULTS" "$STATUS"
rm -f "$LOG"

exit $STATUS
