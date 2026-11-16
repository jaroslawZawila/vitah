// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import { payments } from "../../../../test/invoice-fixture";
import PaymentsScreen from "./PaymentsScreen";

vi.mock("../../../actions/purchase-invoices", () => ({ deletePaymentAction: vi.fn() }));
const actions = await import("../../../actions/purchase-invoices");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/dashboard/compras/pagos",
  useSearchParams: () => new URLSearchParams("page=2"),
}));

function renderScreen(canManage = true, list = payments) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PaymentsScreen payments={list} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.deletePaymentAction).mockReset().mockResolvedValue({ success: true });
});

describe("PaymentsScreen", () => {
  it("shows what falls due each week, past due first, and the payments made", () => {
    renderScreen();

    const forecast = within(screen.getByRole("region", { name: "Previsión de pagos · próximos 30 días" }));
    expect(forecast.getByText("Vencido")).toHaveClass("text-bad");
    expect(forecast.getByRole("link", { name: "SOC-2026/0912" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-912");
    expect(forecast.getByText("Nada")).toBeInTheDocument();
    // What Administration pays: with VAT, as invoiced.
    expect(forecast.getByText("Lo pendiente de cada factura, por semana de vencimiento · IVA incl.")).toBeInTheDocument();

    const list = within(screen.getByRole("region", { name: "Pagos registrados" }));
    const row = within(list.getByRole("table")).getByRole("link", { name: "MSN-2026/148" }).closest("tr")!;
    expect(within(row).getByText("15.000,00")).toBeInTheDocument();
    expect(list.getByRole("columnheader", { name: "Importe · IVA incl." })).toBeInTheDocument();
    expect(within(row).getByText("Transferencia")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Justificante.pdf" })).toHaveAttribute("href", "/api/v1/purchases/payments/pay-1/file");
    expect(within(list.getByRole("table")).getByText(/^Este mes: 15\.000,00\s€ en 1 pago · IVA incl\.$/)).toBeInTheDocument();

    // Phones: a card per payment, opening its invoice, with the amount under its VAT label and the proof.
    const card = within(list.getAllByRole("link", { name: "MSN-2026/148" })[0]!.closest("li")!);
    expect(card.getByRole("link", { name: "MSN-2026/148" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-148");
    expect(card.getByText("Importe · IVA incl.")).toBeInTheDocument();
    expect(card.getByText("15.000,00")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Justificante.pdf" })).toHaveAttribute("href", "/api/v1/purchases/payments/pay-1/file");
    expect(card.getByRole("button", { name: "Quitar el pago del 15 oct 2026" })).toBeInTheDocument();
    expect(list.getAllByText(/^Este mes: 15\.000,00\s€ en 1 pago · IVA incl\.$/)).toHaveLength(2);
  });

  it("pages through the payments made; the month's total is the whole month's", () => {
    renderScreen(true, { ...payments, paging: { page: 2, limit: 50, total: 130, pages: 3 }, summary: { monthCents: 9_876_500, monthPayments: 42 } });

    const list = within(screen.getByRole("region", { name: "Pagos registrados" }));
    expect(within(list.getByRole("table")).getByText(/^Este mes: 98\.765,00\s€ en 42 pagos · IVA incl\.$/)).toBeInTheDocument();
    const pager = within(list.getByRole("navigation", { name: "Páginas" }));
    expect(pager.getByText("51–100 de 130")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/dashboard/compras/pagos");
    expect(pager.getByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/dashboard/compras/pagos?page=3");
  });

  it("takes back a payment recorded by mistake", async () => {
    renderScreen();
    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Quitar el pago del 15 oct 2026" }));
    const dialog = within(await screen.findByRole("alertdialog", { name: /^¿Quitar el pago de 15\.000,00\s€ del 15 oct 2026\?$/ }));
    expect(dialog.getByText(/^Es un pago de la factura MSN-2026\/148 de .*Elementos eliminados\.$/)).toBeInTheDocument();
    expect(actions.deletePaymentAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Quitar pago" }));
    expect(actions.deletePaymentAction).toHaveBeenCalledWith("pay-1");
  });

  it("is read-only for viewers", () => {
    renderScreen(false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // One page holds them all: no pager either.
    expect(screen.queryByRole("navigation", { name: "Páginas" })).not.toBeInTheDocument();
  });
});
