import { describe, expect, it } from "vitest";
import type { BudgetState } from "@repo/core/contract";
import { filterProjects, filtersQuery, hasFilters, NO_FILTERS, parseFilters, toProjectRows } from "./project-list";

const rev = (number: number, status: "draft" | "issued" | "accepted" | "rejected" | "superseded"): BudgetState => ({
  revision: { number, status },
  generation: null,
});
const ai: BudgetState = { revision: null, generation: { status: "running", step: 3 } };
const none: BudgetState = { revision: null, generation: null };

const project = (
  id: string,
  ref: string,
  obraStage: number,
  budget: BudgetState,
  client: { name: string | null; email: string } | null = null,
) => ({ id, ref, address: `Calle ${ref}`, startDate: null, completionDate: null, obraStage, client, budget });

const rows = toProjectRows([
  project("p-1", "VTH-26-001", 6, rev(2, "accepted"), { name: "Lucía Ferrer", email: "lucia@example.com" }),
  project("p-2", "VTH-26-002", 3, rev(1, "issued")),
  project("p-3", "VTH-26-003", 2, rev(0, "draft"), { name: null, email: "javier@example.com" }),
  project("p-4", "VTH-26-004", 1, ai),
  project("p-5", "VTH-26-005", 1, none),
  project("p-6", "VTH-25-011", 8, rev(3, "accepted")),
]);

describe("toProjectRows", () => {
  it("keeps the projects' order, each with its budget", () => {
    expect(rows.map((r) => [r.id, r.budget.revision?.number ?? null])).toEqual([
      ["p-1", 2],
      ["p-2", 1],
      ["p-3", 0],
      ["p-4", null],
      ["p-5", null],
      ["p-6", 3],
    ]);
  });

  it("names the client by name, else by email", () => {
    expect(rows[0]!.clientName).toBe("Lucía Ferrer");
    expect(rows[2]!.clientName).toBe("javier@example.com");
    expect(rows[1]!.clientName).toBeNull();
  });
});

describe("filterProjects", () => {
  const ids = (filters: Partial<typeof NO_FILTERS>) => filterProjects(rows, { ...NO_FILTERS, ...filters }).shown.map((r) => r.id);

  it("shows every project without filters", () => {
    expect(ids({})).toEqual(["p-1", "p-2", "p-3", "p-4", "p-5", "p-6"]);
  });

  it("filters by the budget's state, the AI drafting as a draft", () => {
    expect(ids({ budget: "accepted" })).toEqual(["p-1", "p-6"]);
    expect(ids({ budget: "draft" })).toEqual(["p-3", "p-4"]);
    expect(ids({ budget: "none" })).toEqual(["p-5"]);
  });

  it("filters by the obra's stage", () => {
    expect(ids({ obra: "execution" })).toEqual(["p-1"]);
    expect(ids({ obra: "finished" })).toEqual(["p-6"]);
    expect(ids({ obra: "not_started" })).toEqual(["p-2", "p-3", "p-4", "p-5"]);
  });

  it("combines the filters with the search", () => {
    expect(ids({ budget: "accepted", obra: "execution" })).toEqual(["p-1"]);
    expect(ids({ budget: "draft", query: "javier" })).toEqual(["p-3"]);
    expect(ids({ query: "lucia" })).toEqual(["p-1"]);
  });

  it("counts each option given the other filter and the search", () => {
    const { budgetCounts, obraCounts } = filterProjects(rows, { ...NO_FILTERS, obra: "not_started" });
    expect(budgetCounts).toEqual({ all: 4, draft: 2, issued: 1, accepted: 0, rejected: 0, none: 1 });
    expect(obraCounts).toEqual({ all: 6, not_started: 4, execution: 1, finished: 1 });

    const accepted = filterProjects(rows, { ...NO_FILTERS, budget: "accepted", query: "VTH-26" });
    expect(accepted.obraCounts).toEqual({ all: 1, not_started: 0, execution: 1, finished: 0 });
    expect(accepted.budgetCounts.all).toBe(5);
  });
});

describe("the filters in the URL", () => {
  it("reads them, anything unknown as all", () => {
    expect(parseFilters({ presupuesto: "accepted", obra: "execution", q: "caviedes" })).toEqual({
      budget: "accepted",
      obra: "execution",
      query: "caviedes",
    });
    expect(parseFilters({ presupuesto: "nope", obra: ["finished", "execution"] })).toEqual({ budget: "all", obra: "finished", query: "" });
    expect(parseFilters({})).toEqual(NO_FILTERS);
  });

  it("writes only those set, and round-trips", () => {
    expect(filtersQuery(NO_FILTERS)).toBe("");
    const filters = { budget: "issued", obra: "not_started", query: "calle mayor" } as const;
    expect(filtersQuery(filters)).toBe("?presupuesto=issued&obra=not_started&q=calle+mayor");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersQuery(filters))))).toEqual(filters);
  });

  it("knows whether any is on", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, query: "  " })).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, obra: "finished" })).toBe(true);
  });
});
