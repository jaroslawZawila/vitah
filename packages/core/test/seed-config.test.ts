import { describe, expect, it } from "vitest";
import { seedPassword } from "@repo/db";

// @repo/db has no test suite of its own; its seed guard is tested here.
describe("seedPassword", () => {
  it("uses SEED_ADMIN_PASSWORD when set", () => {
    expect(seedPassword("postgres://u:p@db.example.com/x", { SEED_ADMIN_PASSWORD: "S3cret!" })).toBe(
      "S3cret!",
    );
  });

  it.each(["localhost", "127.0.0.1"])("allows the dev default on %s", (host) => {
    expect(seedPassword(`postgres://u:p@${host}:4432/vitah`, {})).toBe("vitah2026");
  });

  it("refuses the public default on any other database", () => {
    expect(() => seedPassword("postgres://u:p@ep-prod.neon.tech/vitah", {})).toThrow(
      /SEED_ADMIN_PASSWORD/,
    );
  });
});
