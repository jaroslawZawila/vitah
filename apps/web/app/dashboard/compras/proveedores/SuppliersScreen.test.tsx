// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/es.json";
import { tenantSuppliers } from "../../../../test/supplier-fixture";
import SuppliersScreen from "./SuppliersScreen";

function renderScreen(suppliers = tenantSuppliers) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <SuppliersScreen suppliers={suppliers} />
    </NextIntlClientProvider>,
  );
}

const table = () => within(screen.getByRole("table", { name: "Proveedores y sus compras" }));
const names = () => table().getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.querySelector("a")!.textContent);

describe("SuppliersScreen", () => {
  it("shows what is contracted, owed, past due and retained, and the suppliers with orders, owed first", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Proveedores" })).toBeInTheDocument();
    const kpis = within(screen.getByRole("region", { name: "Resumen" }));
    expect(kpis.getByText("90.120 €")).toBeInTheDocument();
    expect(kpis.getByText("2 proveedores con pedidos")).toBeInTheDocument();
    expect(kpis.getByText("4200 €")).toHaveClass("text-bad");
    expect(kpis.getByText("1 proveedor con facturas vencidas")).toBeInTheDocument();

    expect(names()).toEqual(["Montajes Steel Norte S.L.", "Piedra de Liébana S.L."]);
    const [msn, liebana] = table().getAllByRole("row").slice(1);
    expect(msn).toHaveTextContent("CAE pendiente");
    expect(msn).toHaveTextContent("3 · 2 obras");
    expect(liebana).toHaveTextContent("4200,00 vencido");
    expect(table().getByRole("link", { name: "Montajes Steel Norte S.L." })).toHaveAttribute("href", "/dashboard/compras/proveedores/sup-msn");
  });

  it("filters by what is owed or past due, and by name; Todos shows those without orders too", async () => {
    renderScreen();
    const groups = within(screen.getByRole("group", { name: "Mostrar" }));
    await userEvent.click(groups.getByRole("button", { name: /Con vencidas/ }));
    expect(names()).toEqual(["Piedra de Liébana S.L."]);
    await userEvent.click(groups.getByRole("button", { name: /Todos/ }));
    expect(names()).toHaveLength(3);
    await userEvent.type(screen.getByRole("searchbox", { name: "Nombre del proveedor" }), "yesos");
    expect(names()).toEqual(["Yesos y Placas del Norte S.L."]);
  });

  it("says so when there are no companies", () => {
    renderScreen({ ...tenantSuppliers, suppliers: [] });
    expect(screen.getAllByText("Todavía no hay empresas en Subcontratas.").length).toBeGreaterThan(0);
  });
});
