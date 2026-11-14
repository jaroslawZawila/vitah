import { logWarn } from "./log";

// What `GET /api/health` answers with (app/api/health/route.ts). The endpoint
// is public and never cached downstream (`no-store`), so anyone can hit it in
// a loop: the checks' result is kept here for a few seconds per server
// instance, and requests that arrive while they run share that one run. So
// the three checks (database queries, each bounded by the database itself:
// `bounded` in @repo/core/health) run at most once per instance in that time,
// whatever the traffic.

export type Health = {
  status: "ok" | "degraded" | "down";
  /** When the checks ran: up to `HEALTH_FRESH_MS` before the answer. */
  time: string;
  checks: { db: "ok" | "down"; ai: "ok" | "attention" | "unknown"; migrations: "ok" | "untracked" | "unknown" };
};

/** How long a result is served again without running the checks. */
export const HEALTH_FRESH_MS = 10_000;
/** The same while the database is `down`: shorter, so its recovery shows quickly. */
export const HEALTH_DOWN_FRESH_MS = 2_000;
/** How long a check may take: the endpoint answers within this, whatever the database does. */
const CHECK_TIMEOUT_MS = 2_000;

/** `check`'s answer, or `fallback` when it throws or takes too long; why goes to the log, not the answer. */
async function within<T>(name: string, check: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer in ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check(), late]);
  } catch (error) {
    logWarn("health.check_failed", error, { check: name });
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function runChecks(): Promise<Health> {
  // Loaded here, inside the checks: a database that isn't even configured is `down`, not a crash.
  const core = import("@repo/core/health");
  const [db, ai, migrations] = await Promise.all([
    within("db", async () => ((await (await core).pingDatabase()), "ok" as const), "down" as const),
    within("ai", async () => ((await (await core).aiNeedsAttention()) ? ("attention" as const) : ("ok" as const)), "unknown" as const),
    within("migrations", async () => ((await (await core).migrationsTracked()) ? ("ok" as const) : ("untracked" as const)), "unknown" as const),
  ]);
  const status = db !== "ok" ? "down" : ai === "ok" && migrations === "ok" ? "ok" : "degraded";
  return { status, time: new Date().toISOString(), checks: { db, ai, migrations } };
}

let kept: { health: Health; until: number } | null = null;
let running: Promise<Health> | null = null;

/** The system's health: the result kept from the last few seconds, or a fresh run that every caller meanwhile shares. */
export function readHealth(): Promise<Health> {
  if (kept && Date.now() < kept.until) return Promise.resolve(kept.health);
  running ??= runChecks()
    .then((health) => {
      kept = { health, until: Date.now() + (health.status === "down" ? HEALTH_DOWN_FRESH_MS : HEALTH_FRESH_MS) };
      return health;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** Forgets the kept result (for the tests: each starts from nothing). */
export function forgetHealth() {
  kept = null;
  running = null;
}
