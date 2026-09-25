import { daysUntil } from "../lib/dates";

describe("daysUntil", () => {
  const now = new Date("2026-09-25T14:00:00Z");

  it("counts whole days from today in Spain", () => {
    expect(daysUntil("2027-01-15", now)).toBe(112);
    expect(daysUntil("2026-09-25", now)).toBe(0);
    expect(daysUntil("2026-09-20", now)).toBe(-5);
  });

  it("uses Spain's date, not UTC's, around midnight", () => {
    // 23:30 UTC on the 25th is already the 26th in Madrid.
    expect(daysUntil("2026-09-26", new Date("2026-09-25T23:30:00Z"))).toBe(0);
  });
});
