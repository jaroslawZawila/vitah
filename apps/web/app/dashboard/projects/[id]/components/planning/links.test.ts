import { describe, expect, it } from "vitest";
import { obraHref } from "../construction/ObraFrame";
import { planningHref } from "./links";

describe("planningHref", () => {
  it("is Obra › Planificación, as the Obra tab's own links say", () => {
    expect(planningHref("p-1")).toBe(obraHref("p-1", "planning"));
    expect(planningHref("p-1", "editar")).toBe(`${obraHref("p-1", "planning")}/editar`);
    expect(planningHref("p-1", "versiones")).toBe(`${obraHref("p-1", "planning")}/versiones`);
  });
});
