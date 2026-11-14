import { sql, type AnyColumn, type SQL } from "@repo/db";

// A record's number as its label spells it, in SQL: the lists search on it,
// and the search must find what the screen shows (`orderLabel`: PED-007).

/**
 * `number` with zeros in front up to `width` digits, never cut: the SQL of
 * `String(number).padStart(width, "0")`. A bare `lpad(n, 3, '0')` also CUTS a
 * longer number (1000 → "100"), so order PED-1000 would be searched as PED-100.
 */
export const zeroPadded = (number: SQL | AnyColumn, width: number): SQL =>
  sql`lpad((${number})::text, greatest(${sql.raw(String(Math.trunc(width)))}, length((${number})::text)), '0')`;

/** An order's label, as `orderLabel` in ./contract: 'PED-007', 'PED-1000'. */
export const orderLabelSql = (number: SQL | AnyColumn): SQL => sql`('PED-' || ${zeroPadded(number, 3)})`;
