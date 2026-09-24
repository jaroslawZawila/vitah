import { formatDate } from "../lib/format";

describe("formatDate", () => {
  it("formats a calendar date in Spanish", () => {
    expect(formatDate("2026-03-01")).toBe("1 de marzo de 2026");
  });

  it("does not shift the day across time zones", () => {
    expect(formatDate("2026-12-31")).toBe("31 de diciembre de 2026");
  });
});
