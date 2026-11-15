import { describe, expect, it } from "vitest";
import { formatDecimal, formatQuantity } from "@repo/core/format";
import { parseDecimal, parseHundredths } from "./format";

describe("parseDecimal", () => {
  it.each([
    ["3,50", 3.5],
    ["1.234,56", 1234.56],
    ["12.345", 12345],
    ["1.500", 1500],
    ["3.50", 3.5], // a dot that doesn't group thousands is a decimal point
    ["265", 265],
    ["303,6", 303.6],
    ["1.250,50 €", 1250.5],
    ["13 %", 13],
  ])("reads %s in Spanish as %s", (text, value) => {
    expect(parseDecimal(text, "es")).toBe(value);
  });

  it.each([
    ["3.50", 3.5],
    ["1,234.56", 1234.56],
    ["1,234", 1234],
    ["3,5", 3.5],
  ])("reads %s in English as %s", (text, value) => {
    expect(parseDecimal(text, "en")).toBe(value);
  });

  it("reads back what the portal shows", () => {
    expect(parseDecimal(formatQuantity(12345.5, "es"), "es")).toBe(12345.5);
    expect(parseDecimal(formatDecimal(1234.5, "es"), "es")).toBe(1234.5);
    expect(parseDecimal(formatDecimal(1234.5, "en"), "en")).toBe(1234.5);
    expect(parseDecimal(formatDecimal(1234567.89, "es"), "es")).toBe(1234567.89);
  });

  it("rejects what isn't a number", () => {
    expect(parseDecimal("", "es")).toBeNull();
    expect(parseDecimal("abc", "es")).toBeNull();
    expect(parseDecimal("1,2,3", "es")).toBeNull();
  });
});

describe("parseHundredths", () => {
  it("gives cents or basis points, NaN when invalid", () => {
    expect(parseHundredths("9,50", "es")).toBe(950);
    expect(parseHundredths("13", "es")).toBe(1300);
    expect(parseHundredths("x", "es")).toBeNaN();
  });
});
