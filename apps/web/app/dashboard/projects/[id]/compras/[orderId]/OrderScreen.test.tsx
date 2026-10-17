// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { orderDetail } from "../../../../../../test/purchasing-fixture";
import OrderScreen from "./OrderScreen";

vi.mock("../../../../../actions/purchasing", () => ({
  setPurchaseStatusAction: vi.fn(),
  uploadPurchaseFileAction: vi.fn(),
  deletePurchaseFileAction: vi.fn(),
}));
const actions = await import("../../../../../actions/purchasing");

function renderScreen(props: Partial<Parameters<typeof OrderScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <OrderScreen projectId="p-1" order={orderDetail} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.setPurchaseStatusAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.uploadPurchaseFileAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.deletePurchaseFileAction).mockReset().mockResolvedValue({ success: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("OrderScreen", () => {
  it("shows the order: status, supplier, late warning, steps, lines, data and history", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Mampostería de piedra natural, 24 m²" })).toBeInTheDocument();
    expect(screen.getByText("VTH-26-001 · PED-049")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Piedra de Liébana" })).toHaveAttribute("href", "/dashboard/subcontratas/empresas/sup-liebana");

    const late = screen.getByRole("status");
    expect(late).toHaveTextContent("Entrega con 3 días de retraso. Estaba prevista el 14 oct. El capítulo 06 sigue en curso.");
    expect(within(late).getByRole("link", { name: "Registrar incidencia" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/incidencias");

    const steps = within(screen.getByRole("region", { name: "Estado del pedido" }));
    expect(steps.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Pendiente2 oct",
      "Pedido3 oct",
      "Confirmado",
      "En tránsito13 oct",
      "Entregadoprevisto 14 oct",
    ]);
    expect(steps.getByRole("listitem", { current: "step" })).toHaveTextContent("En tránsito");

    const lines = within(screen.getByRole("region", { name: "Partidas del pedido" }));
    expect(lines.getByText("Coste del presupuesto Rev.1 aceptado, sin margen")).toBeInTheDocument();
    const row = lines.getByText("06.05").closest("tr")!;
    expect(within(row).getByText("3324,00")).toBeInTheDocument();
    expect(within(row).getByText("400,00")).toBeInTheDocument();
    expect(within(row).getByText("Sí")).toBeInTheDocument();
    expect(within(row).getByText(/−196,00/)).toHaveClass("text-bad");

    const data = within(screen.getByRole("region", { name: "Datos" }));
    expect(data.getByText("3 oct 2026")).toBeInTheDocument();
    expect(data.getByRole("link", { name: "Pedido_PED-049.pdf" })).toHaveAttribute("href", "/api/v1/purchases/order-49/file");
    expect(data.getByRole("link", { name: "Cambiar" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-49/editar");
    expect(data.getByText("Laura Pérez · 2 oct")).toBeInTheDocument();

    const history = within(screen.getByRole("region", { name: "Historial" }));
    expect(history.getByText("Confirmado → En tránsito")).toBeInTheDocument();
    expect(history.getByText("Importe de 06.05: 3050,00 → 3120,00")).toBeInTheDocument();
    expect(history.getByText(/Portes incluidos/)).toBeInTheDocument();
    expect(history.getByText("Creado con 1 partida, 3050,00 €")).toBeInTheDocument();
  });

  it("records the delivery with its day and a note", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    const form = within(screen.getByRole("form", { name: "Registrar entrega" }));
    expect(form.getByLabelText("Fecha de entrega")).toHaveAttribute("max", "2026-10-17");
    await userEvent.clear(form.getByLabelText("Fecha de entrega"));
    await userEvent.type(form.getByLabelText("Fecha de entrega"), "2026-10-16");
    await userEvent.type(form.getByLabelText("Nota (opcional)"), "Albarán 3321");
    await userEvent.click(form.getByRole("button", { name: "Confirmar entrega" }));

    expect(actions.setPurchaseStatusAction).toHaveBeenCalledWith("p-1", "order-49", {
      status: "delivered",
      date: "2026-10-16",
      note: "Albarán 3321",
    });
    expect(screen.queryByRole("form", { name: "Registrar entrega" })).not.toBeInTheDocument();
  });

  it("moves a pending subcontract on at once, and shows the error core returns", async () => {
    vi.mocked(actions.setPurchaseStatusAction).mockResolvedValue({ error: "invalid_state" });
    renderScreen({ order: { ...orderDetail, kind: "subcontract", status: "pending", lateDays: null } });

    await userEvent.click(screen.getByRole("button", { name: "Marcar contratado" }));
    expect(actions.setPurchaseStatusAction).toHaveBeenCalledWith("p-1", "order-49", { status: "contracted" });
    expect(await screen.findByRole("alert")).toHaveTextContent("El pedido ya no está en ese estado. Recarga la página.");
  });

  it("cancels the order once confirmed", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(window.confirm).toHaveBeenCalledWith("¿Cancelar PED-049? Dejará de sumar a lo contratado.");
    expect(actions.setPurchaseStatusAction).toHaveBeenCalledWith("p-1", "order-49", { status: "cancelled" });
  });

  it("replaces and removes the order's PDF", async () => {
    renderScreen();
    const file = new File(["%PDF"], "contrato.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Sustituir PDF"), file);
    const [projectId, orderId, , data] = vi.mocked(actions.uploadPurchaseFileAction).mock.calls[0]!;
    expect([projectId, orderId]).toEqual(["p-1", "order-49"]);
    expect((data.get("file") as File).name).toBe("contrato.pdf");

    await userEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(actions.deletePurchaseFileAction).toHaveBeenCalledWith("p-1", "order-49");
  });

  it("refuses a PDF over 4 MB before sending it", async () => {
    renderScreen();
    const big = new File(["%PDF"], "grande.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText("Sustituir PDF"), big);
    expect(actions.uploadPurchaseFileAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("El archivo supera el máximo de 4 MB.");
  });

  it("offers nothing to change once delivered or cancelled", () => {
    const { unmount } = renderScreen({ order: { ...orderDetail, status: "delivered", lateDays: null, completedOn: "2026-10-16" } });
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar entrega" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
    unmount();

    renderScreen({ order: { ...orderDetail, status: "cancelled", lateDays: null, reached: { ...orderDetail.reached, cancelled: "2026-10-15" } } });
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.getByText("Cancelado el 15 oct: no suma a lo contratado.")).toBeInTheDocument();
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sustituir PDF")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedido_PED-049.pdf" })).toBeInTheDocument();
  });
});
