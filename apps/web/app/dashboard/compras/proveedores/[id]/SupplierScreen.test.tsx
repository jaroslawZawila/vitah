// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/es.json";
import { supplierPurchasing } from "../../../../../test/supplier-fixture";
import SupplierScreen from "./SupplierScreen";

describe("SupplierScreen", () => {
  it("shows the supplier's figures, its orders, invoices and payments, with its ficha", () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
        <SupplierScreen purchasing={supplierPurchasing} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Montajes Steel Norte S.L." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ficha en Subcontratas" })).toHaveAttribute("href", "/dashboard/subcontratas/empresas/sup-msn");
    const figures = within(screen.getByRole("region", { name: "Resumen" }));
    expect(figures.getByText("3 pedidos en 2 obras")).toBeInTheDocument();
    expect(figures.getByText("Pagado 42.000 € sin IVA")).toBeInTheDocument();

    const orders = within(screen.getByRole("region", { name: /Pedidos/ }));
    expect(orders.getAllByRole("link", { name: "PED-004" })[0]).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    expect(within(screen.getByRole("region", { name: /Facturas/ })).getByRole("link", { name: "MSN-2026/148" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Pagos/ })).getByText("15.000,00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver/ })).toHaveAttribute("href", "/dashboard/compras/proveedores");
  });
});
