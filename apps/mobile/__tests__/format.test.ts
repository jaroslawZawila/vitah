import { formatDate, formatFileSize, formatShortDate } from "../lib/format";

describe("formatDate", () => {
  it("formats a calendar date in Spanish", () => {
    expect(formatDate("2026-03-01")).toBe("1 de marzo de 2026");
  });

  it("does not shift the day across time zones", () => {
    expect(formatDate("2026-12-31")).toBe("31 de diciembre de 2026");
  });
});

describe("formatShortDate", () => {
  it("shows day and short month in Spain's time zone", () => {
    expect(formatShortDate("2026-09-22T10:00:00.000Z")).toMatch(/^22 sept?\.?$/);
    // 23:30 UTC is already the next day in Madrid.
    expect(formatShortDate("2026-06-30T23:30:00.000Z")).toMatch(/^1 jul\.?$/);
  });
});

describe("formatFileSize", () => {
  it("uses KB below a megabyte and MB with a decimal comma above", () => {
    expect(formatFileSize(180 * 1024)).toBe("180 KB");
    expect(formatFileSize(100)).toBe("1 KB");
    expect(formatFileSize(3.1 * 1024 * 1024)).toBe("3,1 MB");
    expect(formatFileSize(4 * 1024 * 1024)).toBe("4 MB");
  });
});
