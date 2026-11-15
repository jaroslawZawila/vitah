import { describe, expect, it } from "vitest";
import type { BudgetState, ProjectSignals } from "@repo/core/contract";
import { filterProjects, filtersQuery, hasFilters, NO_FILTERS, parseFilters, toProjectRows } from "./project-list";

const rev = (number: number, status: "draft" | "issued" | "accepted" | "rejected" | "superseded"): BudgetState => ({
  revision: { number, status },
  generation: null,
});
const ai: BudgetState = { revision: null, generation: { status: "running", step: 3 } };
const none: BudgetState = { revision: null, generation: null };

const calm: ProjectSignals = { schedule: null, progressPct: null, attention: [] };

const project = (
  id: string,
  ref: string,
  obraStage: number,
  budget: BudgetState,
  client: { name: string | null; email: string } | null = null,
  signals: ProjectSignals = calm,
) => ({ id, ref, address: `Calle ${ref}`, startDate: null, completionDate: null, obraStage, client, budget, ...signals });

const late = (days: number): ProjectSignals["schedule"] => ({ status: "late", worst: "finish", days });
const onTime: ProjectSignals["schedule"] = { status: "on_time", worst: null, days: null };

const rows = toProjectRows([
  project("p-1", "VTH-26-001", 6, rev(2, "accepted"), { name: "Lucía Ferrer", email: "lucia@example.com" }, {
    schedule: onTime,
    progressPct: 40,
    attention: [{ kind: "requests", count: 1 }],
  }),
  project("p-2", "VTH-26-002", 3, rev(1, "issued")),
  project("p-3", "VTH-26-003", 2, rev(0, "draft"), { name: null, email: "javier@example.com" }),
  project("p-4", "VTH-26-004", 1, ai),
  project("p-5", "VTH-26-005", 1, none),
  project("p-6", "VTH-25-011", 8, rev(3, "accepted"), null, {
    schedule: late(12),
    progressPct: 100,
    attention: [
      { kind: "to_invoice", count: 1 },
      { kind: "supplier_overdue", count: 2, amountCents: 120_000 },
    ],
  }),
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

describe("the Atención filter", () => {
  const signals = (late_: number | null, attention: ProjectSignals["attention"]): ProjectSignals => ({
    schedule: late_ === null ? onTime : late(late_),
    progressPct: 50,
    attention,
  });
  const urgent = toProjectRows([
    project("a", "VTH-1", 6, rev(0, "accepted"), null, signals(null, [{ kind: "requests", count: 1 }])),
    project("b", "VTH-2", 6, rev(0, "accepted"), null, signals(3, [])),
    project("c", "VTH-3", 6, rev(0, "accepted"), null, signals(null, [])),
    project("d", "VTH-4", 6, rev(0, "accepted"), null, signals(null, [{ kind: "requests", count: 1 }, { kind: "documents", count: 4 }])),
    project("e", "VTH-5", 6, rev(0, "accepted"), null, signals(20, [{ kind: "documents", count: 1 }])),
    project("f", "VTH-6", 6, rev(0, "accepted"), null, signals(null, [{ kind: "documents", count: 3 }])),
    project("g", "VTH-7", 2, none),
  ]);
  const shown = (filters: Partial<typeof NO_FILTERS>) => filterProjects(urgent, { ...NO_FILTERS, ...filters }).shown.map((r) => r.id);

  it("keeps the list's order without it", () => {
    expect(shown({})).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("shows the obras late or with a reason, most urgent first: late, then most kinds of reason, most of them", () => {
    expect(shown({ attention: "attention" })).toEqual(["e", "b", "d", "f", "a"]);
    expect(shown({ attention: "late" })).toEqual(["e", "b"]);
  });

  it("counts each option given the other filters and the search, the late ones among those needing attention", () => {
    expect(filterProjects(urgent, NO_FILTERS).attentionCounts).toEqual({ all: 7, attention: 5, late: 2 });
    expect(filterProjects(urgent, { ...NO_FILTERS, budget: "none" }).attentionCounts).toEqual({ all: 1, attention: 0, late: 0 });
    expect(filterProjects(urgent, { ...NO_FILTERS, query: "VTH-5" }).attentionCounts).toEqual({ all: 1, attention: 1, late: 1 });

    // And the other filters count what it lets through.
    const late_ = filterProjects(urgent, { ...NO_FILTERS, attention: "late" });
    expect(late_.budgetCounts).toMatchObject({ all: 2, accepted: 2, none: 0 });
    expect(late_.obraCounts).toMatchObject({ all: 2, execution: 2, not_started: 0 });
  });

  it("combines with the search and the other filters", () => {
    expect(rows.filter((r) => r.attention.length > 0).map((r) => r.id)).toEqual(["p-1", "p-6"]);
    expect(filterProjects(rows, { ...NO_FILTERS, attention: "attention", obra: "finished" }).shown.map((r) => r.id)).toEqual(["p-6"]);
    expect(filterProjects(rows, { ...NO_FILTERS, attention: "attention", query: "lucia" }).shown.map((r) => r.id)).toEqual(["p-1"]);
  });
});

describe("the filters in the URL", () => {
  it("reads them, anything unknown as all", () => {
    expect(parseFilters({ presupuesto: "accepted", obra: "execution", atencion: "late", q: "caviedes" })).toEqual({
      budget: "accepted",
      obra: "execution",
      attention: "late",
      query: "caviedes",
    });
    expect(parseFilters({ presupuesto: "nope", obra: ["finished", "execution"], atencion: "urgent" })).toEqual({
      budget: "all",
      obra: "finished",
      attention: "all",
      query: "",
    });
    expect(parseFilters({})).toEqual(NO_FILTERS);
  });

  it("writes only those set, and round-trips", () => {
    expect(filtersQuery(NO_FILTERS)).toBe("");
    const filters = { budget: "issued", obra: "not_started", attention: "attention", query: "calle mayor" } as const;
    expect(filtersQuery(filters)).toBe("?presupuesto=issued&obra=not_started&atencion=attention&q=calle+mayor");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersQuery(filters))))).toEqual(filters);
  });

  it("knows whether any is on", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, query: "  " })).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, obra: "finished" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, attention: "late" })).toBe(true);
  });
});
