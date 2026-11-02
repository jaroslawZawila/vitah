import { describe, expect, it } from "vitest";
import { budgetItems } from "../../../../../test/budgets-fixture";
import { searchBudgets } from "./budgets";

describe("budgets overview helpers", () => {
  it("find the obras by code, client or address", () => {
    expect(searchBudgets(budgetItems, "").map((i) => i.ref)).toEqual(budgetItems.map((i) => i.ref));
    expect(searchBudgets(budgetItems, "tres cantos").map((i) => i.ref)).toEqual(["VTH-26-002"]);
    expect(searchBudgets(budgetItems, "LUCIA")).toHaveLength(1);
  });

});
