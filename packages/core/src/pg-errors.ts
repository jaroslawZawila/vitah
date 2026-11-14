// What Postgres said when a statement failed, read in one place: the ORM wraps
// the driver's error and keeps it as `cause`, so the code may be on either.

type PgError = { code?: unknown; constraint_name?: unknown; message?: unknown };

/** The database's own error if its SQLSTATE is one of `codes`: `error` itself, or the cause the ORM wrapped. */
export function pgError(error: unknown, ...codes: string[]): PgError | undefined {
  const candidates = [error, (error as { cause?: unknown } | null | undefined)?.cause];
  return candidates.find(
    (e): e is PgError => typeof e === "object" && e !== null && codes.includes((e as PgError).code as string),
  );
}

/** True for a Postgres unique-constraint violation (e.g. a taken email). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgError(error, "23505");
  return pg !== undefined && (constraint === undefined || pg.constraint_name === constraint);
}

/**
 * True when a statement failed because a table isn't there ("undefined_table"):
 * the portal deployed ahead of the SQL file that makes it (`packages/db/sql/`).
 * With `table`, only when it is that one.
 */
export function isMissingTable(error: unknown, table?: string): boolean {
  const pg = pgError(error, "42P01");
  return pg !== undefined && (table === undefined || String(pg.message).includes(`"${table}"`));
}

/** Postgres aborted the statement to let another go on: a deadlock, or a serialization failure. */
export const isConflict = (error: unknown): boolean => pgError(error, "40P01", "40001") !== undefined;
