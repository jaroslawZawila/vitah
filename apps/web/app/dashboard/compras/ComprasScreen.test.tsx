// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import { tenantPurchases } from "../../../test/purchasing-fixture";
import ComprasScreen from "./ComprasScreen";

function renderScreen(purchases = tenantPurchases) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ComprasScreen purchases={purchases} />
    </NextIntlClientProvider>,
  );
}

const numbers = () =>
  within(screen.getByRole("table", { name: "Pedidos" }))
    .queryAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => text?.startsWith("PED-"));

describe("ComprasScreen", () => {
  it("shows every order of every obra, with the company's totals", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Pedidos" })).toBeInTheDocument();
    const kpis = within(screen.getByRole("region", { name: "Resumen" }));
    expect(kpis.getByText("Contratado en 2026")).toBeInTheDocument();
    expect(kpis.getByText("486.910 €")).toBeInTheDocument();
    expect(kpis.getByText("41 pedidos en 3 obras")).toBeInTheDocument();
    expect(kpis.getByText("9 pedidos por entregar o terminar")).toBeInTheDocument();
    expect(kpis.getByText("4 pedidos pendientes")).toBeInTheDocument();
    expect(kpis.getByText("En VTH-26-001, VTH-26-003")).toBeInTheDocument();

    expect(numbers()).toEqual(["PED-056", "PED-049", "PED-047", "PED-040", "PED-038", "PED-014"]);
    const table = within(screen.getByRole("table", { name: "Pedidos" }));
    const row = table.getByRole("link", { name: "PED-014" }).closest("tr")!;
    expect(within(row).getByRole("link", { name: "VTH-26-003" })).toHaveAttribute("href", "/dashboard/projects/p-3/compras");
    expect(within(row).getByRole("link", { name: "PED-014" })).toHaveAttribute("href", "/dashboard/projects/p-3/compras/order-14");
    expect(within(row).getByText("7 d tarde")).toBeInTheDocument();
    expect(within(row).getByText("30 sept")).toBeInTheDocument();
    // Pending and cancelled ones don't add up: 3.120 + 7.300 + 19.860 + 19.480.
    expect(table.getByText("6 pedidos · contratado").closest("tr")).toHaveTextContent("49.760,00");
  });

  it("filters by state, obra, supplier, type, order date, lateness and text", async () => {
    renderScreen();

    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: /Cancelados/ }));
    expect(numbers()).toEqual(["PED-038"]);
    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: /Todos/ }));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Obra" }), "VTH-26-003 Suances");
    expect(numbers()).toEqual(["PED-014"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Obra" }), "Todas");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "Subcontrato");
    expect(numbers()).toEqual(["PED-056", "PED-047", "PED-040"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "Todos");

    const period = within(screen.getByRole("group", { name: "Fecha de pedido" }));
    await userEvent.type(period.getByLabelText("Desde"), "2026-10-01");
    expect(numbers()).toEqual(["PED-056", "PED-049", "PED-047"]);
    await userEvent.clear(period.getByLabelText("Desde"));

    await userEvent.click(screen.getByRole("checkbox", { name: "Solo con retraso" }));
    expect(numbers()).toEqual(["PED-049", "PED-014"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Solo con retraso" }));

    await userEvent.type(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" }), "ventanas");
    expect(numbers()).toEqual(["PED-014"]);
  });

  it("groups the orders by supplier", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Por proveedor" }));

    const table = within(screen.getByRole("table", { name: "Pedidos por proveedor" }));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Cubiertas Besaya");
    const stone = table.getByRole("link", { name: "Piedra de Liébana" });
    expect(stone).toHaveAttribute("href", "/dashboard/subcontratas/empresas/sup-liebana");
    expect(stone.closest("tr")).toHaveTextContent("Proveedor de material");
  });

  describe("CSV", () => {
    let blobs: Blob[];
    beforeEach(() => {
      blobs = [];
      URL.createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:compras";
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it("exports the filtered orders", async () => {
      renderScreen();
      await userEvent.click(screen.getByRole("checkbox", { name: "Solo con retraso" }));
      await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));

      const text = await blobs[0]!.text();
      const rows = text.replace(/^\uFEFF/, "").split("\r\n");
      expect(rows[0]).toBe(
        "Obra;Nº;Tipo;Proveedor;Concepto;Capítulos;Importe (€, sin IVA);Fecha de pedido;Entrega / trabajos;Entregado / finalizado;Estado;Días de retraso",
      );
      expect(rows.slice(1)).toEqual([
        "VTH-26-001;PED-049;Material;Piedra de Liébana;Mampostería de piedra natural, 24 m²;06;3120,00;2026-10-03;2026-10-14;;En tránsito;3",
        "VTH-26-003;PED-014;Material;Carpinterías Cabezón;Ventanas de aluminio RPT (11 ud);10;19480,00;2026-09-30;2026-10-10;;Confirmado;7",
      ]);
    });
  });

  it("says so when there are no orders", () => {
    renderScreen({ ...tenantPurchases, orders: [] });
    expect(screen.getAllByText("Todavía no hay pedidos.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  });
});
