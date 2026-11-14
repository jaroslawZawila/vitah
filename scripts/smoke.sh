#!/usr/bin/env bash
# Smoke test of a deployed portal: is it up, and are its doors still locked?
#
#   scripts/smoke.sh [--no-health] [base-url]      (default: https://portal.vitah.es)
#
#   GET /                    200                               the login page renders
#   GET /api/v1/projects     401 {"error":"unauthorized"}      the staff API wants a session
#   GET /api/mobile/photos   401 {"error":"unauthorized"}      the app's API wants a token
#   GET /dashboard           a redirect to /                   the portal wants a session
#   GET /api/health          200, "status" ok or degraded      scripts/health.sh (--no-health skips it)
#
# One line per check; exits 1 if any fails. Sends no credentials and writes
# nothing. Needs only curl. Run by .github/workflows/smoke.yml after each
# production deployment, and by hand: scripts/smoke.sh http://localhost:3000
set -euo pipefail

health=1
base=""
for arg in "$@"; do
  case "$arg" in
    --no-health) health=0 ;;
    -h | --help)
      sed -n '2,14s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    -*)
      echo "smoke: unknown option $arg" >&2
      exit 2
      ;;
    *) base=$arg ;;
  esac
done
base=${base:-https://portal.vitah.es}
base=${base%/}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
checks=0
failed=0

# GET $1 without following redirects: sets $code (000 if there was no answer)
# and fills $tmp/body and $tmp/headers. Only a request that got no answer at
# all is repeated, once: an HTTP status is the answer, whatever it is.
get() {
  local attempt
  for attempt in 1 2; do
    : >"$tmp/body"
    : >"$tmp/headers"
    if code=$(curl -sS --max-time 20 -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$base$1"); then
      return 0
    fi
    [ "$attempt" = 1 ] && sleep 3
  done
  code=000
}

pass() {
  checks=$((checks + 1))
  echo "ok    $1"
}

fail() {
  checks=$((checks + 1))
  failed=$((failed + 1))
  echo "FAIL  $1" >&2
}

# The body on one line without whitespace, cut short if it is a whole page.
body() {
  tr -d ' \t\r\n' <"$tmp/body" | head -c 300 || true
}

expect_status() {
  get "$1"
  if [ "$code" = "$2" ]; then
    pass "GET $1 -> $code"
  else
    fail "GET $1 -> $code, expected $2"
  fi
}

expect_unauthorized() {
  local json
  get "$1"
  json=$(body)
  if [ "$code" = 401 ] && [ "$json" = '{"error":"unauthorized"}' ]; then
    pass "GET $1 -> 401 $json"
  else
    fail "GET $1 -> $code $json, expected 401 {\"error\":\"unauthorized\"}"
  fi
}

# A 3xx whose Location is the login page: "/" or "<base>/", with or without a query.
expect_redirect_to_login() {
  local location
  get "$1"
  location=$(grep -i '^location:' "$tmp/headers" | head -n 1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r' || true)
  case "$code" in
    301 | 302 | 303 | 307 | 308)
      case "${location%%\?*}" in
        / | "$base" | "$base/")
          pass "GET $1 -> $code, Location: $location"
          return
          ;;
      esac
      ;;
  esac
  fail "GET $1 -> $code${location:+, Location: $location}, expected a redirect to /"
}

echo "Smoke test of $base"
expect_status / 200
expect_unauthorized /api/v1/projects
expect_unauthorized /api/mobile/photos
expect_redirect_to_login /dashboard
if [ "$health" = 1 ]; then
  checks=$((checks + 1))
  "$(dirname "$0")/health.sh" "$base" || failed=$((failed + 1))
else
  echo "skip  GET /api/health (--no-health)"
fi

if [ "$failed" -gt 0 ]; then
  echo "Smoke test FAILED: $failed of $checks checks against $base" >&2
  exit 1
fi
echo "Smoke test passed: $checks checks against $base"
