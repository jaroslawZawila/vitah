// Money bounds shared by every surface (DB-free, zod-free: the portal and the
// app may import it through @repo/core/contract).

/**
 * The largest amount, in cents, that any money input takes (20 M €). Amounts
 * are stored as 32-bit integers (at most 2 147 483 647 cents, about 21.4 M €),
 * so an input up to this bound always fits, and a larger one is a clean 400
 * (`invalid_input`), never a database error. `cents()` in ./inputs/fields
 * enforces it.
 */
export const MAX_AMOUNT_CENTS = 2_000_000_000;
