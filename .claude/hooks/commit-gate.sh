#!/usr/bin/env bash
# PreToolUse hook: block `git commit` unless tests, type checks and lint are green
# and the portal's production build (`next build`) succeeds.
# Exit 2 blocks the tool call and feeds stderr back to Claude.
set -uo pipefail

command=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tool_input?.command??""))')

[[ "$command" =~ (^|[^[:alnum:]_-])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit([[:space:]]|$) ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 2

if command -v pnpm >/dev/null; then pnpm=(pnpm); else pnpm=(npx --yes pnpm@9.0.0); fi

log=$(mktemp)
if ! "${pnpm[@]}" exec turbo run test check-types lint --output-logs=errors-only >"$log" 2>&1; then
  {
    echo "Commit blocked: tests, type checks or lint are failing. Fix them, then commit again."
    echo "(DB tests need Postgres: pnpm db:up)"
    tail -n 80 "$log"
  } >&2
  rm -f "$log"
  exit 2
fi
# `next build` catches what tsc and lint don't (e.g. a type re-export from a "use server" file).
# Turbo caches it, so an unchanged portal doesn't rebuild. Env comes from apps/web/.env.local.
if ! "${pnpm[@]}" exec turbo run build --filter=web --output-logs=errors-only >"$log" 2>&1; then
  {
    echo "Commit blocked: the portal's production build (next build) fails. Fix it, then commit again."
    tail -n 80 "$log"
  } >&2
  rm -f "$log"
  exit 2
fi
rm -f "$log"
exit 0
