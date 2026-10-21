import { describe, expect, it } from "vitest";
import { obraOptions } from "../../../../test/obra-picker-fixture";
import { matchesObra, toObraOptions } from "./obra-options";

const caviedes = obraOptions[0]!;

describe("obra options", () => {
  it("name the client by name, else by email, and none when there is no client", () => {
    expect(
      toObraOptions([
        { id: "p-1", ref: "A", address: "x", client: { name: null, email: "ana@vitah.es" } },
        { id: "p-2", ref: "B", address: "y", client: null },
      ]).map((o) => o.clientName),
    ).toEqual(["ana@vitah.es", null]);
  });

  it("match every word typed in the code, the client or the address, without accents or case", () => {
    expect(matchesObra(caviedes, "")).toBe(true);
    expect(matchesObra(caviedes, "26-001")).toBe(true);
    expect(matchesObra(caviedes, "pena")).toBe(true);
    expect(matchesObra(caviedes, "VALDALIGA caviedes")).toBe(true);
    expect(matchesObra(caviedes, "ruiz suances")).toBe(false);
  });
});
