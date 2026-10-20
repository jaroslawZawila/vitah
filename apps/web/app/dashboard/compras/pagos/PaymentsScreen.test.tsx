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

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PaymentsScreen payments={payments} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.deletePaymentAction).mockReset().mockResolvedValue({ success: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("PaymentsScreen", () => {
  it("shows what falls due each week, past due first, and the payments made", () => {
    renderScreen();

    const forecast = within(screen.getByRole("region", { name: "Previsión de pagos · próximos 30 días" }));
    expect(forecast.getByText("Vencido")).toHaveClass("text-bad");
    expect(forecast.getByRole("link", { name: "SOC-2026/0912" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-912");
    expect(forecast.getByText("Nada")).toBeInTheDocument();

    const list = within(screen.getByRole("region", { name: "Pagos registrados" }));
    const row = list.getByRole("link", { name: "MSN-2026/148" }).closest("tr")!;
    expect(within(row).getByText("15.000,00")).toBeInTheDocument();
    expect(within(row).getByText("Transferencia")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Justificante.pdf" })).toHaveAttribute("href", "/api/v1/purchases/payments/pay-1/file");
    expect(list.getByText(/^Este mes: 15\.000,00\s€ en 1 pago$/)).toBeInTheDocument();
  });

  it("takes back a payment recorded by mistake", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Quitar el pago del 15 oct" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^¿Quitar el pago de 15\.000,00\s€\?$/));
    expect(actions.deletePaymentAction).toHaveBeenCalledWith("pay-1");
  });

  it("is read-only for viewers", () => {
    renderScreen(false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
