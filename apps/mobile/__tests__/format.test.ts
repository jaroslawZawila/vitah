import { formatFileSize, formatMediumDate, formatShortDate } from "../lib/format";

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

describe("in English", () => {
  it("formats dates and sizes the English way", () => {
    expect(formatShortDate("2026-09-22T10:00:00.000Z", "en")).toMatch(/^22 Sept?$/);
    expect(formatFileSize(3.1 * 1024 * 1024, "en")).toBe("3.1 MB");
  });
});

describe("formatMediumDate", () => {
  it("shows day, short month and year, as in the design", () => {
    expect(formatMediumDate("2026-03-10")).toBe("10 mar 2026");
    expect(formatMediumDate("2027-01-15", "en")).toBe("15 Jan 2027");
  });
});

