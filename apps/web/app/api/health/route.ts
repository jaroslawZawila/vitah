import { NextResponse } from "next/server";
import { readHealth } from "../../../lib/health";

// GET /api/health: for an uptime check, without signing in (proxy.ts lets it
// through). It says whether the portal's parts work and nothing about what is
// in them: no tenant, no name, no id, no count.
//
//   { "status": "ok" | "degraded" | "down", "commit": "b98d632", "time": "…",
//     "checks": { "db": "ok" | "down",
//                 "ai": "ok" | "attention" | "unknown",
//                 "migrations": "ok" | "untracked" | "unknown" } }
//
// 503 when the database doesn't answer (`down`); 200 otherwise, `degraded`
// when another check isn't `ok`. `ai` is `attention` when a budget generation
// failed in the last day, a purchase document has waited over an hour for its
// review, or a tenant is at 90 % of its monthly AI limit (aiNeedsAttention in
// packages/core/src/health.ts). `unknown`: the check itself failed or was too slow.
//
// Being public, it must stay cheap however often it is hit: the checks run at
// most once every 10 seconds per server instance (2 while `down`), requests
// in between get the kept result and `time` says when the checks ran
// (lib/health.ts). The response itself is never cached (`no-store`).

export const dynamic = "force-dynamic";

export async function GET() {
  const { status, time, checks } = await readHealth();

  return NextResponse.json(
    {
      status,
      // Read as the request is served (Vercel sets it on the running function), so no build depends on it.
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
      time,
      checks,
    },
    { status: status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
