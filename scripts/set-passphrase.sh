#!/usr/bin/env bash
# Set the demo passphrase, deploy, and prove it works — in one pass.
#
#   scripts/set-passphrase.sh [base-url]
#
# Why this exists rather than `wrangler pages secret put` on its own:
#
# Setting the passphrase and checking the passphrase used to be two separate
# prompts, and a mismatch between them is invisible from outside — the door
# returns the same 401 for "wrong passphrase" as it does for "you typed
# something subtly different the first time". That ambiguity cost an afternoon.
#
# Here the value is read once, piped to wrangler without an interactive prompt
# in the middle, and then re-used from memory to verify. There is no second
# typing to get wrong. It is never echoed and never written to disk.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

BASE="${1:-https://ratify-4pp.pages.dev}"
PROJECT="ratify"

printf 'New demo passphrase: ' >&2
IFS= read -rs PASS
printf '\nAgain to confirm:    ' >&2
IFS= read -rs CONFIRM
printf '\n\n' >&2

if [ "$PASS" != "$CONFIRM" ]; then
  printf 'Those do not match. Nothing was changed.\n' >&2
  exit 1
fi

if [ -z "$PASS" ]; then
  printf 'Empty passphrase. Nothing was changed.\n' >&2
  exit 1
fi

# Reject what the door would only trim away later, so what is stored is what
# gets typed.
case "$PASS" in
  ' '*|*' ') printf 'That has a leading or trailing space. Nothing was changed.\n' >&2; exit 1 ;;
esac

printf 'Uploading the secret...\n'
if ! printf '%s' "$PASS" | npx wrangler pages secret put DEMO_PASSPHRASE --project-name "$PROJECT"; then
  printf 'Could not upload the secret.\n' >&2
  exit 1
fi

printf '\nDeploying (Pages binds secrets at deploy time, so this is required)...\n'
DEPLOY_LOG=$(mktemp)
trap 'rm -f "$DEPLOY_LOG"' EXIT
if ! npm run deploy:pages 2>&1 | tee "$DEPLOY_LOG"; then
  printf 'Deploy failed.\n' >&2
  exit 1
fi

DEPLOYMENT=$(grep -oE 'https://[a-z0-9]+\.[a-z0-9-]+\.pages\.dev' "$DEPLOY_LOG" | tail -1)
printf '\nWaiting for %s to become the live deployment...\n' "${DEPLOYMENT:-the new build}"

# Poll the version endpoint rather than sleeping a guessed interval: it reports
# exactly which build is answering, so we wait for the right one and no longer.
for _ in $(seq 1 30); do
  LIVE=$(curl -s --max-time 10 "$BASE/api/version" |
    sed -n 's/.*"deployment":"\([^"]*\)".*/\1/p')
  [ -n "$DEPLOYMENT" ] && [ "$LIVE" = "$DEPLOYMENT" ] && break
  sleep 5
done
printf 'Live: %s\n' "${LIVE:-unknown}"

printf '\nVerifying with the value you just set — no retyping.\n'
RATIFY_PASSPHRASE="$PASS" exec bash scripts/verify-gate.sh "$BASE"
