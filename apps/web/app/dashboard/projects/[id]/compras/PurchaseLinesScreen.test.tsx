// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/es.json";
import { lines } from "../../../../../test/invoice-fixture";
import PurchaseLinesScreen from "./PurchaseLinesScreen";

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PurchaseLinesScreen projectId="p-1" header={{ ref: "VTH-26-001", stage: 4, openIssues: 0 }} lines={lines} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

const table = () => within(screen.getByRole("region", { name: "Partidas del presupuesto" }));
const row = (code: string) => table().getByText(code).closest("tr")!;

describe("PurchaseLinesScreen", () => {
  it("shows the obra's figures, its invoices due and each line's state", () => {
    renderScreen();

    const views = within(screen.getByRole("navigation", { name: "Vista" }));
    expect(views.getByRole("link", { name: "Partidas" })).toHaveAttribute("aria-current", "page");
    expect(views.getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras?vista=pedidos");

    const kpis = within(screen.getByRole("region", { name: "Resumen de compras" }));
    expect(kpis.getByText("Facturado")).toBeInTheDocument();
    expect(kpis.getByText("61.980 €")).toBeInTheDocument();
    expect(kpis.getByText("1 abono")).toBeInTheDocument();
    expect(kpis.getByText("Vencido 3180 €")).toHaveClass("text-bad");

    const due = screen.getByRole("status");
    expect(due).toHaveTextContent("2 facturas vencidas o que vencen en los próximos 7 días.");
    expect(within(due).getByRole("link", { name: /SOC-2026\/0912/ })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-912");
    expect(due).toHaveTextContent("venció el 15 oct");
    expect(within(due).getByRole("link", { name: "Ver vencimientos" })).toHaveAttribute("href", "/dashboard/compras/facturas");

    expect(within(row("03.01")).getByText("Factura")).toBeInTheDocument();
    expect(within(row("03.01")).getByText("−7000,00")).toHaveClass("text-bad");
    expect(within(row("02.02")).getByText("Vencida")).toBeInTheDocument();
    expect(within(row("10.01")).getByText("Por contratar 10.900,00")).toBeInTheDocument();
    expect(within(row("10.01")).getByText("Pendiente de contratar")).toBeInTheDocument();
  });

  it("filters by state and folds a line open on its orders, milestones and invoices", async () => {
    renderScreen();

    expect(table().getByText("Total · 3 partidas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Pendiente de contratar/ }));
    expect(table().queryByText("03.01")).not.toBeInTheDocument();
    // The obra's totals don't add up the rows shown: hidden while filtered.
    expect(table().queryByText(/^Total ·/)).not.toBeInTheDocument();
    await userEvent.click(within(row("10.01")).getByRole("button", { expanded: false }));
    expect(table().getByText(/debe pedirse antes del 3 nov/)).toBeInTheDocument();
    expect(table().getByRole("link", { name: "Crear pedido" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/nuevo?capitulo=10");

    await userEvent.click(screen.getByRole("button", { name: /^Todas/ }));
    const toggle = within(row("03.01")).getByRole("button", { expanded: false });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(table().getByRole("link", { name: "PED-004" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    expect(table().getByText("Fin de montaje")).toBeInTheDocument();
    expect(table().getByRole("link", { name: "MSN-2026/148" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-148");
    expect(table().getByText("Pagados 15.000,00 · quedan 13.500,00")).toBeInTheDocument();
    expect(table().getByText("Por facturar", { selector: "span.text-muted-foreground" })).toBeInTheDocument();
  });

  it("offers no new order to viewers", async () => {
    renderScreen(false);
    expect(screen.queryByRole("link", { name: "Nuevo pedido" })).not.toBeInTheDocument();
    await userEvent.click(within(row("10.01")).getByRole("button", { expanded: false }));
    expect(table().queryByRole("link", { name: "Crear pedido" })).not.toBeInTheDocument();
  });
});
