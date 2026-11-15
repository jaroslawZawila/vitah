import { describe, expect, it } from "vitest";
import {
  foldAccents,
  formatAmount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDecimal,
  formatFileSize,
  formatMonth,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  formatSignedAmount,
  formatSignedMoney,
  formatSignedPercent,
} from "../src/format";

// Spaces as the module writes them: a no-break space before € and % in Spanish.
const nb = (text: string) => text.replaceAll(" ", " ");

describe("numbers", () => {
  it.each([
    [0, "0", "0"],
    [7, "7", "7"],
    [999, "999", "999"],
    [1000, "1.000", "1,000"],
    [8543, "8.543", "8,543"], // four digits: Spanish groups them too
    [12500, "12.500", "12,500"],
    [1234567, "1.234.567", "1,234,567"],
    [123456789012, "123.456.789.012", "123,456,789,012"],
    [-4016, "−4.016", "−4,016"],
  ])("groups %d always: %s / %s", (value, es, en) => {
    expect(formatNumber(value, "es")).toBe(es);
    expect(formatNumber(value, "en")).toBe(en);
  });

  it("takes the decimals it is told, rounding half away from zero", () => {
    expect(formatNumber(8543.98, "es", { maxDecimals: 2 })).toBe("8.543,98");
    expect(formatNumber(8543.98, "en", { maxDecimals: 2 })).toBe("8,543.98");
    expect(formatNumber(2.5, "es")).toBe("3");
    expect(formatNumber(-2.5, "es")).toBe("−3");
    expect(formatNumber(1.5, "es", { maxDecimals: 2 })).toBe("1,5");
    expect(formatNumber(1.5, "es", { minDecimals: 2 })).toBe("1,50");
    expect(formatNumber(9999.999, "es", { maxDecimals: 2 })).toBe("10.000");
    // Halves a double cannot hold exactly still round up, as written.
    expect(formatNumber(1.005, "es", { maxDecimals: 2 })).toBe("1,01");
    expect(formatNumber(-1.005, "es", { maxDecimals: 2 })).toBe("−1,01");
    expect(formatNumber(120.145, "es", { maxDecimals: 2 })).toBe("120,15");
    expect(formatNumber(1e20, "en")).toBe("100,000,000,000,000,000,000");
    expect(formatNumber(1e-7, "es", { maxDecimals: 2 })).toBe("0");
  });

  it("never writes minus zero", () => {
    expect(formatNumber(-0, "es")).toBe("0");
    expect(formatNumber(-0.001, "es", { maxDecimals: 2 })).toBe("0");
    expect(formatDecimal(-0.001, "es")).toBe("0,00");
  });

  it("writes decimals and quantities", () => {
    expect(formatDecimal(253.4, "es")).toBe("253,40");
    expect(formatDecimal(4016.26, "es")).toBe("4.016,26");
    expect(formatDecimal(4016.26, "en")).toBe("4,016.26");
    expect(formatDecimal(12.3456, "es", 3)).toBe("12,346");
    expect(formatQuantity(12345.5, "es")).toBe("12.345,5");
    expect(formatQuantity(0.125, "en")).toBe("0.125");
    expect(formatQuantity(3, "es")).toBe("3");
  });
});

describe("money", () => {
  it.each([
    [0, "0,00 €", "€0.00"],
    [1, "0,01 €", "€0.01"],
    [86301, "863,01 €", "€863.01"],
    [854398, "8.543,98 €", "€8,543.98"],
    [401626, "4.016,26 €", "€4,016.26"],
    [1026850, "10.268,50 €", "€10,268.50"],
    [950200, "9.502,00 €", "€9,502.00"], // a KPI keeps its cents, as the rows under it
    [123456789012, "1.234.567.890,12 €", "€1,234,567,890.12"],
    [-19000, "−190,00 €", "−€190.00"],
    [-341200, "−3.412,00 €", "−€3,412.00"],
  ])("%d cents → %s / %s", (cents, es, en) => {
    expect(formatMoney(cents, "es")).toBe(nb(es));
    expect(formatMoney(cents, "en")).toBe(en);
  });

  it("writes amounts without the symbol, for tables headed in euros", () => {
    expect(formatAmount(863891, "es")).toBe("8.638,91");
    expect(formatAmount(863891, "en")).toBe("8,638.91");
    expect(formatAmount(-312000, "es")).toBe("−3.120,00");
    expect(formatAmount(0, "es")).toBe("0,00");
  });

  it("signs deviations: + above zero, − below, nothing for zero", () => {
    expect(formatSignedMoney(257000, "es")).toBe(nb("+2.570,00 €"));
    expect(formatSignedMoney(-120000, "es")).toBe(nb("−1.200,00 €"));
    expect(formatSignedMoney(0, "es")).toBe(nb("0,00 €"));
    expect(formatSignedMoney(257000, "en")).toBe("+€2,570.00");
    expect(formatSignedAmount(19600, "es")).toBe("+196,00");
    expect(formatSignedAmount(-235000, "es")).toBe("−2.350,00");
    expect(formatSignedAmount(0, "en")).toBe("0.00");
  });

  it("takes any tag of the language", () => {
    expect(formatMoney(854398, "es-ES")).toBe(nb("8.543,98 €"));
    expect(formatMoney(854398, "en-GB")).toBe("€8,543.98");
  });
});

describe("percentages", () => {
  it("writes basis points with up to two decimals, or as told", () => {
    expect(formatPercent(1926, "es")).toBe(nb("19,26 %"));
    expect(formatPercent(1926, "en")).toBe("19.26%");
    expect(formatPercent(2400, "es")).toBe(nb("24 %"));
    expect(formatPercent(1250, "es", { minDecimals: 1 })).toBe(nb("12,5 %"));
    expect(formatPercent(0, "es")).toBe(nb("0 %"));
    expect(formatPercent(1_234_500, "es")).toBe(nb("12.345 %"));
  });

  it("signs them", () => {
    expect(formatSignedPercent(140, "es")).toBe(nb("+1,4 %"));
    expect(formatSignedPercent(-140, "es", 2)).toBe(nb("−1,40 %"));
    expect(formatSignedPercent(-2, "es")).toBe(nb("0,0 %"));
  });
});

describe("file sizes", () => {
  it("writes kB below a megabyte, MB with one decimal above", () => {
    expect(formatFileSize(10, "es")).toBe("1 kB");
    expect(formatFileSize(340 * 1024, "es")).toBe("340 kB");
    expect(formatFileSize(3.1 * 1024 * 1024, "es")).toBe("3,1 MB");
    expect(formatFileSize(1500 * 1024 * 1024, "en")).toBe("1,500 MB");
  });
});

describe("dates", () => {
  it("writes a calendar day as day, short month and year, as it is", () => {
    expect(formatDate("2026-03-10", "es")).toBe("10 mar 2026");
    expect(formatDate("2026-03-10", "en")).toBe("10 Mar 2026");
    expect(formatDate("2026-09-01", "es")).toBe("1 sept 2026");
    expect(formatDate("2026-01-15", "es")).toBe("15 ene 2026");
    expect(formatDate("2026-12-31", "en")).toBe("31 Dec 2026");
  });

  it("writes a dash for a missing day", () => {
    expect(formatDate(null, "es")).toBe("—");
    expect(formatDate(undefined, "en")).toBe("—");
    expect(formatDate("", "es")).toBe("—");
  });

  it("writes a timestamp's day in Spain, around midnight", () => {
    // 23:30 UTC in winter is 00:30 the next day in Madrid (UTC+1).
    expect(formatDate("2026-01-14T23:30:00Z", "es")).toBe("15 ene 2026");
    expect(formatDate("2026-01-14T22:59:00Z", "es")).toBe("14 ene 2026");
    // In summer (UTC+2) 22:00 UTC is already the next day.
    expect(formatDate("2026-07-14T22:00:00Z", "es")).toBe("15 jul 2026");
    expect(formatDate("2026-07-14T21:59:59Z", "es")).toBe("14 jul 2026");
    expect(formatDate(new Date("2026-12-31T23:00:00Z"), "en")).toBe("1 Jan 2027");
  });

  it("keeps a date column's UTC midnight on its own day", () => {
    expect(formatDate(new Date("2026-03-10T00:00:00Z"), "es")).toBe("10 mar 2026");
    expect(formatDate(new Date("2026-08-01T00:00:00Z"), "es")).toBe("1 ago 2026");
  });

  it("writes a moment with its time in Spain, across the changes of hour", () => {
    expect(formatDateTime("2026-11-14T09:05:00Z", "es")).toBe("14 nov 2026, 10:05");
    expect(formatDateTime("2026-11-14T09:05:00Z", "en")).toBe("14 Nov 2026, 10:05");
    expect(formatDateTime("2026-01-14T23:30:00Z", "es")).toBe("15 ene 2026, 00:30");
    // 29 March 2026: 01:59 UTC+1, then clocks go from 02:00 to 03:00.
    expect(formatDateTime("2026-03-29T00:59:00Z", "es")).toBe("29 mar 2026, 01:59");
    expect(formatDateTime("2026-03-29T01:00:00Z", "es")).toBe("29 mar 2026, 03:00");
    // 25 October 2026: 02:59 UTC+2, then 03:00 goes back to 02:00.
    expect(formatDateTime("2026-10-25T00:59:00Z", "es")).toBe("25 oct 2026, 02:59");
    expect(formatDateTime("2026-10-25T01:00:00Z", "es")).toBe("25 oct 2026, 02:00");
    expect(formatDateTime(new Date("2026-06-30T22:00:00Z"), "es")).toBe("1 jul 2026, 00:00");
  });

  it("writes ranges and axis months", () => {
    expect(formatDateRange("2026-10-13", "2026-10-17", "es")).toBe("13 oct 2026 – 17 oct 2026");
    expect(formatDateRange("2026-10-13", "2026-10-13", "en")).toBe("13 Oct 2026");
    expect(formatMonth("2026-06-01", "es")).toBe("jun");
    expect(formatMonth("2026-06-01", "en")).toBe("Jun");
  });

  it("refuses what isn't a date", () => {
    expect(() => formatDate("soon", "es")).toThrow(RangeError);
  });
});

describe("search", () => {
  it("folds case and accents away", () => {
    expect(foldAccents("Peñacastillo")).toBe("penacastillo");
    expect(foldAccents("CIMENTACIÓN y Pingüino")).toBe("cimentacion y pinguino");
  });
});
