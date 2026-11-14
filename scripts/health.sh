#!/usr/bin/env bash
# Asks a deployed portal how it is: GET <base-url>/api/health.
#
#   scripts/health.sh [--strict] [base-url]        (default: https://portal.vitah.es)
#
# Passes when the answer is HTTP 200 with JSON whose "status" is "ok" or
# "degraded"; with --strict only "ok" passes. No answer, any other HTTP status
# (503 is how the portal says "down") or any other status fails with exit 1.
# The body is always printed. A failed attempt is repeated once after
# HEALTH_RETRY_WAIT seconds (default 10), so one network blip is not an alert.
#
# Needs only curl; uses jq when it is there. Run by .github/workflows/health.yml
# and by scripts/smoke.sh.
set -euo pipefail

strict=0
base=""
for arg in "$@"; do
  case "$arg" in
    --strict) strict=1 ;;
    -h | --help)
      sed -n '2,13s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    -*)
      echo "health: unknown option $arg" >&2
      exit 2
      ;;
    *) base=$arg ;;
  esac
done
base=${base:-https://portal.vitah.es}
url="${base%/}/api/health"
wait_seconds=${HEALTH_RETRY_WAIT:-10}

body=$(mktemp)
trap 'rm -f "$body"' EXIT

# The top-level "status" of the JSON in $body, or nothing.
status_of_body() {
  if command -v jq >/dev/null 2>&1; then
    jq -r 'if type == "object" then (.status // "") else "" end' "$body" 2>/dev/null || true
  else
    # Without jq: the first "status" in the text. That is the overall one only
    # if the endpoint writes it before its checks' own; GitHub's runners have jq.
    grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$body" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true
  fi
}

# One attempt. Sets $problem and returns 1 when the portal is not well.
probe() {
  local code status
  : >"$body"
  if ! code=$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' "$url"); then
    problem="no answer"
    return 1
  fi
  status=$(status_of_body)
  # A page of HTML (a 404, a proxy's error) is cut short; the JSON is a few lines.
  head -c 2000 "$body"
  echo
  if [ "$code" != 200 ]; then
    problem="HTTP $code${status:+, status \"$status\"}"
    return 1
  fi
  case "$status" in
    ok) return 0 ;;
    degraded)
      [ "$strict" = 0 ] && return 0
      problem="status \"degraded\" (only \"ok\" passes with --strict)"
      ;;
    "") problem="HTTP 200 without a JSON \"status\"" ;;
    *) problem="status \"$status\"" ;;
  esac
  return 1
}

problem=""
if probe; then
  echo "ok    GET $url"
  exit 0
fi
echo "retry GET $url: $problem; trying once more in ${wait_seconds}s" >&2
sleep "$wait_seconds"
if probe; then
  echo "ok    GET $url (second attempt)"
  exit 0
fi
echo "FAIL  GET $url: $problem" >&2
exit 1
