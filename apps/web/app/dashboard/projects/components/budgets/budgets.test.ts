import { describe, expect, it } from "vitest";
import { budgetItems } from "../../../../../test/budgets-fixture";
import { neighbours, searchBudgets, switchBudgetHref } from "./budgets";

describe("budgets overview helpers", () => {
  it("find the obras by code, client or address", () => {
    expect(searchBudgets(budgetItems, "").map((i) => i.ref)).toEqual(budgetItems.map((i) => i.ref));
    expect(searchBudgets(budgetItems, "tres cantos").map((i) => i.ref)).toEqual(["VTH-26-002"]);
    expect(searchBudgets(budgetItems, "LUCIA")).toHaveLength(1);
  });

  it("find the obras before and after the current one, going round", () => {
    expect(neighbours(budgetItems, "p-2")).toMatchObject({ index: 1, previous: { projectId: "p-3" }, next: { projectId: "p-4" } });
    expect(neighbours(budgetItems, "p-5")).toMatchObject({ index: 4, next: { projectId: "p-3" } });
  });

  it("open the same budget page for another obra, keeping the chapter, not the revision", () => {
    expect(switchBudgetHref("/dashboard/projects/p-1/budget", "", "p-2")).toBe("/dashboard/projects/p-2/budget");
    expect(switchBudgetHref("/dashboard/projects/p-1/budget/lines", "chapter=06&revision=r-1", "p-2")).toBe(
      "/dashboard/projects/p-2/budget/lines?chapter=06",
    );
    expect(switchBudgetHref("/dashboard/projects/p-1", "", "p-3")).toBe("/dashboard/projects/p-3/budget");
  });
});
