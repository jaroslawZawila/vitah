import { describe, expect, it } from "vitest";
import { db, sql } from "@repo/db";
import { orderLabel } from "../src/contract";
import { orderLabelSql, zeroPadded } from "../src/sql-labels";

describe("a number's label in SQL", () => {
  const NUMBERS = [1, 7, 99, 100, 123, 999, 1000, 12_345];

  it("spells an order as the screen does, whatever its length: zeros in front, never cut", async () => {
    const rows = await db.execute<{ n: number; label: string }>(
      sql`select n, ${orderLabelSql(sql`n`)} as label from (values ${sql.join(NUMBERS.map((n) => sql`(${n}::int)`), sql`, `)}) v(n) order by n`,
    );

    expect(rows.map((row) => row.label)).toEqual(NUMBERS.map(orderLabel));
    expect(rows.map((row) => row.label)).toEqual(["PED-001", "PED-007", "PED-099", "PED-100", "PED-123", "PED-999", "PED-1000", "PED-12345"]);
  });

  it("pads to the width asked for, as padStart does", async () => {
    const [row] = await db.execute<{ seven: string; hundred: string; computed: string }>(
      sql`select ${zeroPadded(sql`7`, 2)} as seven, ${zeroPadded(sql`100`, 2)} as hundred, ${zeroPadded(sql`99 + 901`, 3)} as computed`,
    );

    expect(row).toEqual({ seven: "07", hundred: "100", computed: "1000" });
  });
});
