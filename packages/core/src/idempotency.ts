import { and, db, eq, idempotencyKeys, lt, sql } from "@repo/db";
import type { Ctx } from "./context";
import { CoreError, invalid } from "./errors";
import { logWarn } from "./log";
import { isMissingTable } from "./pg-errors";
import type { Tx } from "./project-client";
import { sweepNowAndThen } from "./sweep";

// ─── Idempotency keys ─────────────────────────────────────────────────────────
// A create its caller may send twice (a double click, a browser or an app
// sending the request again after a timeout) is applied once. The caller sends
// a key of its own with the request (`idempotencyKey` in the body; the API
// also takes the `Idempotency-Key` header), and the database keeps it per
// tenant and operation (`scope`) in `idempotency_keys`, with what the first
// call answered:
//
//   - The key is inserted INSIDE the create's own transaction, before anything
//     else, and the answer is stored in that same transaction. So a create that
//     fails (its transaction rolls back) keeps no key: the same key runs again.
//   - A second call with the key finds the row and gets the stored answer; the
//     create does not run again.
//   - A second call while the first is still on its way waits on that insert
//     (the primary key makes it wait for the first transaction to end): the
//     first committed → the stored answer; it rolled back → this one runs.
//   - The same key with another request (its hash differs) is a client's bug:
//     409 `idempotency_key_reused`, and nothing runs.
//   - No key: the create runs as it always did. Callers from before keys (and
//     the installed app) send none.
//
// Keys are the tenant's (the same key in two tenants is two keys) and the
// operation's. They are kept a week, then swept away now and then (./sweep.ts).
//
// `idempotent` is the one way in: it wraps a whole create and hands it the
// `once` its transaction runs in.
//
// Without the table (the portal deployed ahead of
// packages/db/sql/2026-11-14-1700-idempotency-keys.sql) a keyed create runs as
// an unkeyed one, with a warning: the key's first read, made before the
// create's transaction opens, is what finds out, so no statement of that
// transaction ever fails on it (it would abort all of it).
// ─────────────────────────────────────────────────────────────────────────────

/** A UUID, or 16–100 URL-safe characters. */
const KEY_FORMAT = /^[A-Za-z0-9_-]{16,100}$/;

/** How long a key is remembered. */
export const KEEP_KEYS_MS = 7 * 24 * 60 * 60 * 1000;

/** The table's name in the database, as an error about it spells it. */
const KEYS_TABLE = "idempotency_keys";

const reused = () => new CoreError("idempotency_key_reused", 409);

/** The caller's key: undefined when there is none, `invalid_input` when it isn't one. */
function parseKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !KEY_FORMAT.test(value)) throw invalid();
  return value;
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (bytes: BufferSource) => hex(await crypto.subtle.digest("SHA-256", bytes));

/** The value with its keys in order and nothing undefined; a file as its size and its content's hash. */
async function canonical(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return { $file: await sha256(await value.arrayBuffer()), size: value.size };
  if (Array.isArray(value)) return Promise.all(value.map(canonical));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value)
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(await Promise.all(entries.map(async ([name, field]) => [name, await canonical(field)] as const)));
}

/** What tells one request from another: the same fields give the same hash, in whatever order they came. */
export const requestHash = async (request: unknown) => sha256(new TextEncoder().encode(JSON.stringify(await canonical(request))));

/** Whose key it is: a staff member's `Ctx`, or a mobile-app client's own identity (tenant and user). */
type Caller = Pick<Ctx, "tenantId" | "userId">;

type Claim = { ctx: Caller; scope: string; key: string; hash: string };

const rowOf = ({ ctx, scope, key }: Claim) =>
  and(eq(idempotencyKeys.tenantId, ctx.tenantId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key));

/** What the key's first call answered, if it is in; `idempotency_key_reused` if that was another request. */
async function stored(run: Tx | typeof db, claim: Claim): Promise<{ result: unknown } | undefined> {
  const [row] = await run
    .select({ hash: idempotencyKeys.requestHash, result: idempotencyKeys.result })
    .from(idempotencyKeys)
    .where(rowOf(claim));
  if (!row) return undefined;
  if (row.hash !== claim.hash) throw reused();
  return { result: row.result };
}

/**
 * Takes the key for this transaction, or says what its first call answered.
 * The insert waits for a transaction that holds the key to end: committed,
 * its row is there to read; rolled back, the key is this transaction's.
 */
async function claimKey(tx: Tx, claim: Claim): Promise<{ result: unknown } | undefined> {
  // More than once only if a sweep removes the row between the insert and the read.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [mine] = await tx
      .insert(idempotencyKeys)
      .values({ tenantId: claim.ctx.tenantId, scope: claim.scope, key: claim.key, userId: claim.ctx.userId, requestHash: claim.hash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (mine) return undefined;
    const first = await stored(tx, claim);
    if (first) return first;
  }
  throw new Error("Could not take the idempotency key");
}

/** Runs `fn` with the key taken and keeps its answer, or returns the answer of the call that had it. */
async function runOnce<T>(tx: Tx, claim: Claim, fn: () => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  const first = await claimKey(tx, claim);
  if (first) return { result: first.result as T, replayed: true };
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ result: result ?? null })
    .where(rowOf(claim));
  return { result, replayed: false };
}

/**
 * A create's `once`, bound to its key: `db.transaction((tx) => once(tx, async () => { … }))`,
 * first in that transaction. It runs `fn` and keeps its answer (as JSON) with
 * the key; a call made while another with the key is in flight waits for it
 * here. If `fn` throws, the transaction rolls back and the key with it.
 */
export type Once<T> = (tx: Tx, fn: () => Promise<T>) => Promise<T>;

/** The key's first call answered while this one was on its way: unwinds it, to answer the same. */
class Replayed extends Error {
  constructor(readonly result: unknown) {
    super("replayed");
  }
}

/**
 * A whole create, once per `input.idempotencyKey`: `create` gets a `once` to
 * wrap what it writes in its transaction, as its first statement, returning
 * the create's answer. `target` is what the create is on (its project,
 * order or invoice), part of the request with the rest of `input`.
 *
 * - A key already in: its answer, at once. Nothing is validated, uploaded or
 *   written again, so a retry doesn't fail on what the first call changed.
 * - A key taken while this call was on its way (both sent at once): this
 *   call's transaction waits for the other, then unwinds (`storeFiles` removes
 *   what it uploaded) and answers the same.
 * - A failure: nothing was applied and the key is free again. Unless the
 *   other call got there in between, and then its answer is the truth.
 * - No key: `create` runs as without any of this.
 */
export async function idempotent<T>(
  ctx: Caller,
  scope: string,
  target: Record<string, string>,
  input: Record<string, unknown>,
  create: (once: Once<T>) => Promise<T>,
): Promise<T> {
  const { idempotencyKey, ...body } = input;
  const key = parseKey(idempotencyKey);
  const unkeyed = () => create((_tx, fn) => fn());
  if (key === undefined) return unkeyed();
  const claim: Claim = { ctx, scope, key, hash: await requestHash({ target, body }) };
  let before: { result: unknown } | undefined;
  try {
    before = await stored(db, claim);
  } catch (error) {
    // No table yet: nothing can be remembered, and creating must not stop.
    if (!isMissingTable(error, KEYS_TABLE)) throw error;
    logWarn("idempotency.table_missing", error, { scope });
    return unkeyed();
  }
  if (before) return before.result as T;
  let result: T;
  try {
    result = await create(async (tx, fn) => {
      const run = await runOnce(tx, claim, fn);
      if (run.replayed) throw new Replayed(run.result);
      return run.result;
    });
  } catch (error) {
    if (error instanceof Replayed) return error.result as T;
    if (error instanceof CoreError) {
      const meanwhile = await stored(db, claim);
      if (meanwhile) return meanwhile.result as T;
    }
    throw error;
  }
  await sweepOldKeys();
  return result;
}

/**
 * Now and then (./sweep.ts), after a keyed create, deletes the keys older than
 * a week, by the database's clock, which dated them.
 */
export const sweepOldKeys = () =>
  sweepNowAndThen("idempotency.sweep_failed", () =>
    db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, sql`now() - make_interval(secs => ${KEEP_KEYS_MS / 1000})`)),
  );
