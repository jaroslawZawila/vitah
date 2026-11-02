import { beforeEach, describe, expect, it, vi } from "vitest";
import BudgetsPage from "./presupuestos/page";
import ObraPurchasesPage from "./compras/page";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

describe("the old Proyectos sections", () => {
  beforeEach(() => redirect.mockClear());

  it("sends Presupuestos to the project list", () => {
    BudgetsPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("sends Compras de obra to the project list, every stage included", () => {
    ObraPurchasesPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard/projects");
  });
});
