// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { orderDetail } from "../../../../../../test/purchasing-fixture";
import { invoiceItem, milestones } from "../../../../../../test/invoice-fixture";
import OrderScreen from "./OrderScreen";

vi.mock("../../../../../actions/purchasing", () => ({
  setPurchaseStatusAction: vi.fn(),
  addOrderDocumentAction: vi.fn(),
  addOrderDocumentVersionAction: vi.fn(),
  deleteOrderDocumentAction: vi.fn(),
}));
vi.mock("../../../../../actions/purchase-invoices", () => ({ setOrderMilestonesAction: vi.fn() }));
const actions = await import("../../../../../actions/purchasing");
const invoiceActions = await import("../../../../../actions/purchase-invoices");

function renderScreen(props: Partial<Parameters<typeof OrderScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <OrderScreen projectId="p-1" order={orderDetail} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.setPurchaseStatusAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.addOrderDocumentAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.addOrderDocumentVersionAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.deleteOrderDocumentAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(invoiceActions.setOrderMilestonesAction).mockReset().mockResolvedValue({ success: true });
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
    expect(within(row).getByText(/\+196,00/)).toHaveClass("text-bad");

    const data = within(screen.getByRole("region", { name: "Datos" }));
    expect(data.getByText("3 oct 2026")).toBeInTheDocument();
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

  it("lists the order's documents, each with its versions", () => {
    renderScreen();
    const documents = within(screen.getByRole("region", { name: /Documentos/ }));
    expect(documents.getByText("Pedido PED-049")).toBeInTheDocument();
    expect(documents.getByText("v2 · vigente")).toBeInTheDocument();
    const [current, older] = documents.getAllByRole("link", { name: /Pedido_PED-049\.pdf/ });
    expect(current).toHaveAttribute("href", "/api/v1/purchases/order-49/documents/doc-1");
    expect(older).toHaveAttribute("href", "/api/v1/purchases/order-49/documents/doc-1?versionId=v-1");
    expect(documents.getByText(/«Portes incluidos»/)).toBeInTheDocument();
  });

  it("adds a document named after its file, a new version with its reason, and removes one", async () => {
    renderScreen();
    const documents = within(screen.getByRole("region", { name: /Documentos/ }));
    await userEvent.click(documents.getByRole("button", { name: "+ Añadir documento" }));
    const contract = new File(["%PDF"], "Contrato firmado.pdf", { type: "application/pdf" });
    await userEvent.upload(documents.getByLabelText("Elegir archivo"), contract);
    expect(documents.getByLabelText("Nombre")).toHaveValue("Contrato firmado");
    await userEvent.click(documents.getByRole("button", { name: "Subir" }));
    const [projectId, orderId, added] = vi.mocked(actions.addOrderDocumentAction).mock.calls[0]!;
    expect([projectId, orderId, added.get("title"), added.get("file")]).toEqual(["p-1", "order-49", "Contrato firmado", contract]);

    await userEvent.click(documents.getByRole("button", { name: "Nueva versión" }));
    const v3 = new File(["%PDF"], "v3.pdf", { type: "application/pdf" });
    await userEvent.upload(documents.getByLabelText("Elegir archivo"), v3);
    await userEvent.type(documents.getByLabelText("Motivo (opcional)"), "Precio corregido");
    await userEvent.click(documents.getByRole("button", { name: "Subir" }));
    const [, , documentId, version] = vi.mocked(actions.addOrderDocumentVersionAction).mock.calls[0]!;
    expect([documentId, version.get("file"), version.get("note")]).toEqual(["doc-1", v3, "Precio corregido"]);

    await userEvent.click(documents.getByRole("button", { name: "Quitar Pedido PED-049" }));
    expect(window.confirm).toHaveBeenCalledWith("¿Quitar «Pedido PED-049» con todas sus versiones?");
    expect(actions.deleteOrderDocumentAction).toHaveBeenCalledWith("p-1", "order-49", "doc-1");
  });

  it("says why a document couldn't be removed", async () => {
    vi.mocked(actions.deleteOrderDocumentAction).mockResolvedValue({ error: "not_found" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Quitar Pedido PED-049" }));
    const documents = within(screen.getByRole("region", { name: /Documentos/ }));
    expect(await documents.findByRole("alert")).toHaveTextContent("No se ha encontrado el pedido.");
    // Opening a form starts clean.
    await userEvent.click(documents.getByRole("button", { name: "+ Añadir documento" }));
    expect(documents.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a PDF over 4 MB before sending it", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "+ Añadir documento" }));
    const big = new File(["%PDF"], "grande.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText("Elegir archivo"), big);
    expect(screen.getByRole("alert")).toHaveTextContent("El archivo supera el máximo de 4 MB.");
    expect(screen.getByRole("button", { name: "Subir" })).toBeDisabled();
    expect(actions.addOrderDocumentAction).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: "+ Añadir documento" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Pedido_PED-049\.pdf/ })).toHaveLength(2);
  });

  describe("invoices", () => {
    /** PED-004: the structure, contracted, with its three milestones and invoices. */
    const structure = {
      ...orderDetail,
      id: "order-4",
      number: 4,
      kind: "subcontract" as const,
      status: "contracted" as const,
      lateDays: null,
      amountCents: 8_700_000,
      description: "Estructura Steel Frame",
      terms: { paymentDays: 30, retentionBp: 500, vatKind: "reverse_charge" as const },
      milestones,
      invoices: [invoiceItem()],
      invoicing: { invoicedCents: 5_880_000, paidCents: 4_236_000, outstandingCents: 1_350_000, retainedCents: 294_000, toInvoiceCents: 2_820_000 },
    };

    it("shows the schedule, its invoices, the order's invoicing and its terms; registers an invoice", () => {
      renderScreen({ order: structure });

      expect(screen.getByRole("link", { name: "Registrar factura" })).toHaveAttribute("href", "/dashboard/compras/facturas/nueva?pedido=order-4");
      const schedule = within(screen.getByRole("region", { name: "Hitos de pago del contrato" }));
      const second = schedule.getByText("Entrega en obra").closest("tr")!;
      expect(within(second).getByText("34,48")).toBeInTheDocument();
      expect(within(second).getByText("Factura")).toBeInTheDocument();
      expect(within(second).getByRole("link", { name: "MSN-2026/148" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-148");
      expect(schedule.getByText("✓ Cuadra con el pedido")).toBeInTheDocument();
      expect(schedule.getByText("28.200,00")).toBeInTheDocument();

      const invoices = within(screen.getByRole("region", { name: /Facturas del pedido/ }));
      const row = invoices.getByRole("link", { name: "MSN-2026/148" }).closest("tr")!;
      expect(within(row).getByText("Pago parcial")).toBeInTheDocument();
      expect(within(row).getByText("28.500,00")).toBeInTheDocument();

      const data = within(screen.getByRole("region", { name: "Datos" }));
      expect(data.getByText("30 días desde la factura")).toBeInTheDocument();
      expect(data.getByText("5 % de garantía")).toBeInTheDocument();
      expect(data.getByText("Inversión del sujeto pasivo")).toBeInTheDocument();
    });

    it("edits the schedule: an invoiced milestone stays, the others add up to the order", async () => {
      renderScreen({ order: structure });
      const schedule = within(screen.getByRole("region", { name: "Hitos de pago del contrato" }));
      await userEvent.click(schedule.getByRole("button", { name: "Editar hitos" }));

      expect(schedule.getByRole("textbox", { name: "Importe del hito 1" })).toBeDisabled();
      expect(schedule.queryByRole("button", { name: "Quitar el hito 1" })).not.toBeInTheDocument();
      const third = schedule.getByRole("textbox", { name: "Importe del hito 3" });
      await userEvent.clear(third);
      await userEvent.type(third, "18000");
      expect(schedule.getByRole("button", { name: "Guardar hitos" })).toBeDisabled();

      await userEvent.click(schedule.getByRole("button", { name: "+ Añadir hito" }));
      await userEvent.type(schedule.getByRole("textbox", { name: "Concepto del hito 4" }), "Recepción");
      expect(schedule.getByRole("textbox", { name: "Importe del hito 4" })).toHaveValue("9000,00");
      await userEvent.click(schedule.getByRole("button", { name: "Guardar hitos" }));

      expect(invoiceActions.setOrderMilestonesAction).toHaveBeenCalledWith("order-4", [
        { id: "m-1", concept: "Inicio de fabricación", amountCents: 3_000_000 },
        { id: "m-2", concept: "Entrega en obra", amountCents: 3_000_000 },
        { id: "m-3", concept: "Fin de montaje", amountCents: 1_800_000 },
        { concept: "Recepción", amountCents: 900_000 },
      ]);
      expect(await schedule.findByRole("button", { name: "Editar hitos" })).toBeInTheDocument();
    });

    it("shows a pending order's invoices without a way to register one, and viewers no editing", () => {
      renderScreen({ order: { ...orderDetail, status: "pending", lateDays: null } });
      expect(screen.queryByRole("link", { name: "Registrar factura" })).not.toBeInTheDocument();
      expect(screen.getByText("Sin hitos: las facturas se registran libremente contra el pedido.")).toBeInTheDocument();
      expect(screen.getByText("Todavía no hay facturas de este pedido.")).toBeInTheDocument();
    });
  });
});

describe("OrderScreen from a purchase request", () => {
  it("links back to the request it was made from", () => {
    renderScreen({ order: { ...orderDetail, request: { id: "req-1", number: 1 } } });
    expect(screen.getByRole("link", { name: "SOL-001" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/solicitudes/req-1");
  });
});
