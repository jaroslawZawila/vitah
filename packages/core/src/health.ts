import { db, sql } from "@repo/db";
import { liveCheck } from "./purchase-check-data";

// What the portal's health endpoint (`GET /api/health`, no sign-in) may know
// about the system: whether each part works, across every tenant at once.
// Each check answers yes or no and nothing else: never a count, a name, an id
// or whose data it was.
//
// The endpoint is public, so a check must not be able to pile work onto the
// database: each runs in a short transaction whose statements the database
// itself cancels after `HEALTH_STATEMENT_TIMEOUT_MS` (`bounded`). The portal
// adds its own time limit for the answer and keeps the result for a few
// seconds (apps/web/lib/health.ts), so the checks run at most once per
// instance in that time, however often the endpoint is hit.

/** How long the database works on one check's statement before cancelling it: under the portal's own limit. */
export const HEALTH_STATEMENT_TIMEOUT_MS = 1_500;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs a check's statements in a transaction where the database cancels any
 * that takes longer than `ms` (`SET LOCAL statement_timeout`: it ends with the
 * transaction and touches no other query on the connection). A check the
 * portal stopped waiting for therefore stops running too, instead of holding
 * a connection of the app's pool.
 */
export function bounded<T>(run: (tx: Transaction) => Promise<T>, ms = HEALTH_STATEMENT_TIMEOUT_MS): Promise<T> {
  return db.transaction(async (tx) => {
    // SET takes no parameters: the number is ours, never a caller's text.
    await tx.execute(sql.raw(`set local statement_timeout = ${Math.max(1, Math.trunc(ms))}`));
    return run(tx);
  });
}

/** The database answers a `select 1`; throws when it doesn't. */
export async function pingDatabase(): Promise<void> {
  await bounded((tx) => tx.execute(sql`select 1`));
}

/** A failed AI budget draft is worth a look for a day. */
const FAILED_WITHIN = sql`interval '24 hours'`;
/** A purchase document's review runs right after its upload: one still waiting after this is stuck. */
const PENDING_FOR = sql`interval '1 hour'`;
/** The share of a tenant's monthly AI limit (cents) from which it is about to stop: 90 %, in micro-USD per cent. */
const NEAR_LIMIT_MICRO_PER_CENT = 9_000;

/**
 * Whether the AI needs someone to look at it: a budget generation failed in
 * the last 24 hours, a purchase document has waited over an hour for its
 * review (those of deleted records aside: they are never reviewed), or a
 * tenant with a monthly limit has spent 90 % of it this month (a limit of 0
 * is the AI switched off: nothing to look at).
 */
export async function aiNeedsAttention(): Promise<boolean> {
  const [row] = await bounded((tx) => tx.execute<{ attention: boolean }>(sql`
    select (
      exists (select 1 from budget_generations where status = 'failed' and updated_at > now() - ${FAILED_WITHIN})
      or exists (
        select 1 from purchase_document_checks
        where status = 'pending' and created_at < now() - ${PENDING_FOR} and ${liveCheck})
      or exists (
        select 1 from tenants t
        where t.ai_monthly_limit_cents > 0
          and (
            select coalesce(sum(u.cost_micro_usd), 0) from ai_usage u
            where u.tenant_id = t.id and u.created_at > date_trunc('month', now())
          ) >= t.ai_monthly_limit_cents::bigint * ${NEAR_LIMIT_MICRO_PER_CENT})
    ) as attention`));
  return row?.attention === true;
}

/**
 * Whether the database records which migrations it has had (a
 * `schema_migrations` table). Only that it exists: its contents are the
 * migration tooling's business.
 */
export async function migrationsTracked(): Promise<boolean> {
  const [row] = await bounded((tx) =>
    tx.execute<{ tracked: boolean }>(sql`select to_regclass('schema_migrations') is not null as tracked`),
  );
  return row?.tracked === true;
}
