import { describe, expect, it } from "vitest";
import { bcryptCost } from "../src/accounts";

describe("bcryptCost", () => {
  it("is 12 unless set", () => {
    expect(bcryptCost(undefined, "production")).toBe(12);
  });

  it("never goes below 12 outside tests", () => {
    expect(bcryptCost("4", "production")).toBe(12);
    expect(bcryptCost("4", undefined)).toBe(12);
    expect(bcryptCost("13", "production")).toBe(13);
  });

  it("may be lowered in tests", () => {
    expect(bcryptCost("4", "test")).toBe(4);
  });

  it.each(["abc", "", "2", "31", "10.5"])("ignores the malformed cost %j", (raw) => {
    expect(bcryptCost(raw, "test")).toBe(12);
  });
});
