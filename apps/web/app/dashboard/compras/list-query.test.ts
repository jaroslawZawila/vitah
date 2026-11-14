import { describe, expect, it } from "vitest";
import { hasInvoicesFilter, hasOrdersFilter, invoicesPage, ordersFilters, ordersPage, parseInvoicesQuery, parseOrdersQuery } from "./list-query";

describe("Compras › Pedidos query", () => {
  it("reads the filters and the page from the URL", () => {
    const query = parseOrdersQuery({
      vista: "proveedores",
      estado: "open",
      obra: "p-1",
      proveedor: "s-1",
      tipo: "material",
      desde: "2026-10-01",
      hasta: "2026-10-31",
      retraso: "1",
      q: " piedra ",
      page: "3",
    });
    expect(query).toEqual({
      view: "suppliers",
      group: "open",
      projectId: "p-1",
      supplierId: "s-1",
      kind: "material",
      from: "2026-10-01",
      to: "2026-10-31",
      lateOnly: true,
      query: "piedra",
      page: 3,
    });
    expect(hasOrdersFilter(query)).toBe(true);
    expect(ordersPage(query)).toEqual({
      group: "open",
      projectId: "p-1",
      supplierId: "s-1",
      kind: "material",
      from: "2026-10-01",
      to: "2026-10-31",
      late: "1",
      q: "piedra",
      page: 3,
      limit: 50,
      by: "supplier",
    });
    // The export: the same filters, no page.
    expect(ordersFilters(query)).not.toHaveProperty("page");
  });

  it("takes what it doesn't understand as no filter and the first page", () => {
    const query = parseOrdersQuery({ estado: "nope", tipo: "x", desde: "2026-02-31", hasta: "ayer", page: "0", retraso: "si", vista: ["x"] });
    expect(query).toEqual({
      view: "orders",
      group: "all",
      projectId: "",
      supplierId: "",
      kind: "all",
      from: "",
      to: "",
      lateOnly: false,
      query: "",
      page: 1,
    });
    expect(hasOrdersFilter(query)).toBe(false);
    expect(ordersPage(query)).not.toHaveProperty("by");
    for (const page of ["-2", "1.5", "abc", "99999999999", ""]) expect(parseOrdersQuery({ page }).page).toBe(1);
    // A repeated parameter counts once.
    expect(parseOrdersQuery({ page: ["4", "9"] }).page).toBe(4);
  });
});

describe("Compras › Facturas query", () => {
  it("reads the filters and the page from the URL", () => {
    const query = parseInvoicesQuery({ estado: "overdue", obra: "p-1", proveedor: "s-1", q: "F26", page: "2" });
    expect(query).toEqual({ group: "overdue", projectId: "p-1", supplierId: "s-1", query: "F26", page: 2 });
    expect(invoicesPage(query)).toEqual({ group: "overdue", projectId: "p-1", supplierId: "s-1", q: "F26", page: 2, limit: 50 });
    expect(hasInvoicesFilter(query)).toBe(true);
  });

  it("falls back to every invoice, first page", () => {
    const query = parseInvoicesQuery({ estado: "pending", page: "x" });
    expect(query).toEqual({ group: "all", projectId: "", supplierId: "", query: "", page: 1 });
    expect(hasInvoicesFilter(query)).toBe(false);
  });
});
