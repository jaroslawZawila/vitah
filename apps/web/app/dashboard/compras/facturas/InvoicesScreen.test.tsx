// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/es.json";
import { invoices } from "../../../../test/invoice-fixture";
import InvoicesScreen from "./InvoicesScreen";

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <InvoicesScreen invoices={invoices} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

const numbers = () =>
  within(screen.getByRole("region", { name: "Facturas recibidas" }))
    .queryAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => /^[A-Z]{3}-/.test(text ?? ""));

describe("InvoicesScreen", () => {
  it("shows what is owed, past due and due soon, and every invoice owed first", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar factura" })).toHaveAttribute("href", "/dashboard/compras/facturas/nueva");
    const kpis = within(screen.getByRole("region", { name: "Resumen de facturas" }));
    expect(kpis.getByText("17.348 €")).toBeInTheDocument();
    expect(kpis.getByText("2 facturas de 2 proveedores")).toBeInTheDocument();
    expect(kpis.getByText("3848 €")).toHaveClass("text-bad");

    expect(numbers()).toEqual(["SOC-2026/0912", "MSN-2026/148", "MSN-2026/112", "MSN-2026/R07"]);
    const overdue = screen.getByRole("link", { name: "SOC-2026/0912" }).closest("tr")!;
    expect(within(overdue).getByText("hace 4 días")).toHaveClass("text-bad");
    expect(within(overdue).getByText("Vencida")).toBeInTheDocument();
    const partial = screen.getByRole("link", { name: "MSN-2026/148" }).closest("tr")!;
    expect(within(partial).getByText("en 3 días")).toBeInTheDocument();
    expect(within(partial).getByRole("link", { name: /PED-004 · Entrega en obra/ })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    const credit = screen.getByRole("link", { name: "MSN-2026/R07" }).closest("tr")!;
    expect(within(credit).getByText("rectifica MSN-2026/112")).toBeInTheDocument();
  });

  it("filters by state, supplier and text", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: /Vencidas/ }));
    expect(numbers()).toEqual(["SOC-2026/0912"]);
    await userEvent.click(screen.getByRole("button", { name: /Abonos/ }));
    expect(numbers()).toEqual(["MSN-2026/R07"]);

    await userEvent.click(screen.getByRole("button", { name: /^Todas/ }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "sup-soc");
    expect(numbers()).toEqual(["SOC-2026/0912"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "");
    await userEvent.type(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" }), "PED-004");
    expect(numbers()).toEqual(["MSN-2026/148", "MSN-2026/112", "MSN-2026/R07"]);
    await userEvent.type(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" }), "x");
    expect(screen.getByText("Ninguna factura con estos filtros.")).toBeInTheDocument();
  });

  it("offers no registering to viewers", () => {
    renderScreen(false);
    expect(screen.queryByRole("link", { name: "Registrar factura" })).not.toBeInTheDocument();
  });
});
