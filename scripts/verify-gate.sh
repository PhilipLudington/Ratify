#!/usr/bin/env bash
# Phase 0 readiness check, run against a live deployment.
#
#   scripts/verify-gate.sh https://ratify-4pp.pages.dev
#
# Reads the passphrase from $RATIFY_PASSPHRASE, or prompts for it with hidden
# input. It is never echoed, never written to a file, and never appears in a
# command line — which matters because Phase 6 assembles a public prompt
# history out of these sessions.
#
# Checks, in order: the client serves, the gate turns away the unauthenticated
# and the wrong passphrase, the right passphrase issues a cookie, a write
# survives into a later request, and two sessions land in different Durable
# Objects that cannot read each other.

set -uo pipefail

BASE="${1:-https://ratify-4pp.pages.dev}"
JAR="$(mktemp -d)"
trap 'rm -rf "$JAR"' EXIT

if [ -z "${RATIFY_PASSPHRASE:-}" ]; then
  printf 'Passphrase for %s: ' "$BASE" >&2
  read -rs RATIFY_PASSPHRASE
  printf '\n' >&2
fi

PASSED=0
FAILED=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASSED=$((PASSED + 1)); }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; printf '        %s\n' "$2"; FAILED=$((FAILED + 1)); }

check() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$2], got [$3]"; fi
}

api() { # method path [cookie-jar] [json-body]
  local method="$1" path="$2" jar="${3:-}" body="${4:-}"
  local args=(-s -o "$JAR/body" -w '%{http_code}' -X "$method" "$BASE$path"
              -H 'Content-Type: application/json')
  [ -n "$jar" ] && args+=(-b "$JAR/$jar" -c "$JAR/$jar")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

body() { cat "$JAR/body"; }

# jq is not assumed; these are small, well-formed payloads.
field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$JAR/body"; }

printf '\nRatify — Phase 0 readiness check\n%s\n\n' "$BASE"

printf 'The client\n'
check "static page serves" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"

printf '\nThe gate\n'
check "unauthenticated /api/ping is refused" "401" "$(api GET /api/ping)"
check "unauthenticated /api/session answers" "200" "$(api GET /api/session)"
check "  ... and reports no session" '{"authenticated":false}' "$(body)"

STATUS=$(api POST /api/auth "" "$(printf '{"passphrase":"definitely-not-the-passphrase"}')")
check "wrong passphrase is refused" "401" "$STATUS"

STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/ping" \
  -H "Cookie: ratify_session=00000000000000000000000000000000.bm90YXNpZ25hdHVyZQ")
check "forged cookie is refused" "401" "$STATUS"

printf '\nAuthentication\n'
STATUS=$(curl -s -o "$JAR/body" -w '%{http_code}' -c "$JAR/alice" -X POST "$BASE/api/auth" \
  -H 'Content-Type: application/json' \
  --data-binary @<(printf '{"passphrase":"%s"}' "$RATIFY_PASSPHRASE"))
check "correct passphrase is accepted" "200" "$STATUS"

if grep -q ratify_session "$JAR/alice" 2>/dev/null; then
  pass "a session cookie is issued"
else
  fail "a session cookie is issued" "no ratify_session in the cookie jar"
fi

check "session endpoint answers for the cookie" "200" "$(api GET /api/session alice)"
check "  ... reporting an authenticated session" '{"authenticated":true}' "$(body)"

printf '\nThe log survives across requests\n'
check "write is accepted" "200" "$(api POST /api/ping alice '{"note":"use Postgres for the job queue"}')"
ALICE_LOG=$(field log)

check "read returns what was written" "200" "$(api GET /api/ping alice)"
NOTE=$(field note)
check "  ... with the same value" "use Postgres for the job queue" "$NOTE"

printf '\nTwo sessions cannot see each other\n'
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR/bob" -X POST "$BASE/api/auth" \
  -H 'Content-Type: application/json' \
  --data-binary @<(printf '{"passphrase":"%s"}' "$RATIFY_PASSPHRASE"))
check "a second session authenticates" "200" "$STATUS"

api POST /api/ping bob '{"note":"ship on Cloudflare"}' > /dev/null
BOB_LOG=$(field log)

if [ -n "$ALICE_LOG" ] && [ "$ALICE_LOG" != "$BOB_LOG" ]; then
  pass "the two sessions address different Durable Objects"
else
  fail "the two sessions address different Durable Objects" "both resolved to [$ALICE_LOG]"
fi

api GET /api/ping alice > /dev/null
check "the first session's value is untouched" "use Postgres for the job queue" "$(field note)"

api GET /api/ping bob > /dev/null
check "the second session's value is its own" "ship on Cloudflare" "$(field note)"

printf '\n%s\n' "----------------------------------------"
printf '  %d passed, %d failed\n\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
