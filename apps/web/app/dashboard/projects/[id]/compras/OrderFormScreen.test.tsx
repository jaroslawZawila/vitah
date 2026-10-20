// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { editForm, purchaseForm } from "../../../../../test/purchasing-fixture";
import OrderFormScreen from "./OrderFormScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../actions/purchasing", () => ({
  createPurchaseAction: vi.fn(),
  updatePurchaseAction: vi.fn(),
  addOrderDocumentAction: vi.fn(),
}));
const actions = await import("../../../../actions/purchasing");

function renderScreen(props: Partial<Parameters<typeof OrderFormScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <OrderFormScreen projectId="p-1" form={purchaseForm} chapter="07" {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  router.push.mockReset();
  vi.mocked(actions.createPurchaseAction).mockReset().mockResolvedValue({ success: true, orderId: "order-57", number: 57 });
  vi.mocked(actions.updatePurchaseAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.addOrderDocumentAction).mockReset().mockResolvedValue({ success: true });
});

const suppliers = () => within(screen.getByRole("group", { name: "Proveedores" }));
const total = () => within(screen.getByRole("region", { name: "Total" }));

/** A subcontract for Revocos on 07.01 (amount retyped) and 07.04 (left open). */
async function fillSubcontract() {
  await userEvent.click(screen.getByRole("radio", { name: /Subcontrato/ }));
  await userEvent.click(suppliers().getByRole("button", { name: /Revocos Cantábrico/ }));
  await userEvent.type(screen.getByLabelText("Concepto"), "Trasdosados y tabiquería");
  await userEvent.type(screen.getByLabelText("Trabajos desde"), "2026-11-02");
  await userEvent.click(screen.getByRole("checkbox", { name: "Incluir 07.01" }));
  const amount = screen.getByRole("textbox", { name: "Importe de 07.01" });
  await userEvent.clear(amount);
  await userEvent.type(amount, "7.250,00");
  await userEvent.click(screen.getByRole("checkbox", { name: "Incluir 07.04" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "07.04 cierra la partida" }));
}

describe("OrderFormScreen", () => {
  it("numbers the new order and starts on the chapter asked for, with its simulated plan", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Nuevo pedido" })).toBeInTheDocument();
    expect(screen.getByText("VTH-26-001 · se numerará PED-057")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Capítulo" })).toHaveValue("07");
    expect(screen.getByText(/Capítulo 07 previsto/)).toBeInTheDocument();
    expect(screen.getByText(/pedir antes del 19 oct/)).toBeInTheDocument();
    expect(screen.getByText("Simulado")).toBeInTheDocument();
    expect(screen.getByLabelText("Entrega prevista")).toBeInTheDocument();
  });

  it("warns when the subcontractor isn't cleared for CAE, without blocking it", async () => {
    renderScreen();
    expect(suppliers().getByRole("button", { name: /Yesos y Placas/ })).toHaveTextContent("Sin CAE");
    await userEvent.click(suppliers().getByRole("button", { name: /Revocos Cantábrico/ }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Revocos Cantábrico S.L. no está apta para CAE: falta RNT del último mes. Puedes guardar el pedido",
    );
    expect(within(screen.getByRole("status")).getByRole("link", { name: "Ver ficha" })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/empresas/sup-revocos",
    );
  });

  it("never offers a material supplier a subcontract, and picking one makes it a material order", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("radio", { name: /Subcontrato/ }));
    expect(suppliers().queryByRole("button", { name: /Yesos y Placas/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Pedido de material/ }));
    await userEvent.click(suppliers().getByRole("button", { name: /Yesos y Placas/ }));
    expect(screen.getByRole("radio", { name: /Pedido de material/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.type(screen.getByRole("searchbox", { name: "Proveedor" }), "aislam");
    expect(suppliers().getAllByRole("button")).toHaveLength(1);
  });

  it("totals the lines live, with the deviation only over the ones it closes", async () => {
    renderScreen();
    await fillSubcontract();

    const open = screen.getByRole("textbox", { name: "Importe de 07.04" }).closest("tr")!;
    // 07.04 starts on what is left to contract: 2.660 − 1.000.
    expect(screen.getByRole("textbox", { name: "Importe de 07.04" })).toHaveValue("1660,00");
    expect(within(open).getByText("abierta")).toBeInTheDocument();
    const closed = screen.getByRole("textbox", { name: "Importe de 07.01" }).closest("tr")!;
    expect(within(closed).getByText("+190,00")).toHaveClass("text-good");

    expect(total().getByText("8910,00 €")).toBeInTheDocument();
    expect(total().getByText("Desviación en 1 partida cerrada")).toBeInTheDocument();
    expect(total().getByText("+190,00 €")).toBeInTheDocument();
  });

  it("saves as contracted with its lines, then opens the order", async () => {
    renderScreen();
    await fillSubcontract();
    await userEvent.click(screen.getByRole("button", { name: "Guardar y marcar contratado" }));

    expect(actions.createPurchaseAction).toHaveBeenCalledWith("p-1", {
      kind: "subcontract",
      subcontractorId: "sup-revocos",
      description: "Trasdosados y tabiquería",
      orderedOn: "2026-10-17",
      expectedOn: null,
      workStart: "2026-11-02",
      workEnd: null,
      lines: [
        { lineageId: "lin-0701", amountCents: 725_000, closesLine: true },
        { lineageId: "lin-0704", amountCents: 166_000, closesLine: false },
      ],
      paymentDays: null,
      retentionBp: 0,
      vatKind: null,
      status: "contracted",
    });
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras/order-57");
  });

  it("sends the terms its invoices start from: days to pay, retention and VAT", async () => {
    renderScreen();
    await fillSubcontract();
    expect(screen.getByRole("combobox", { name: "IVA de sus facturas" })).toHaveDisplayValue("Según el tipo (Inversión del sujeto pasivo)");
    await userEvent.type(screen.getByRole("textbox", { name: "Días de pago" }), "60");
    await userEvent.type(screen.getByRole("textbox", { name: "Retención de garantía (%)" }), "5");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "IVA de sus facturas" }), "vat21");
    await userEvent.click(screen.getByRole("button", { name: "Guardar y marcar contratado" }));

    expect(actions.createPurchaseAction).toHaveBeenCalledWith("p-1", expect.objectContaining({ paymentDays: 60, retentionBp: 500, vatKind: "vat21" }));
  });

  it("saves as pending without an order date, and uploads the PDF once the order exists", async () => {
    renderScreen();
    await fillSubcontract();
    const file = new File(["%PDF"], "contrato.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Elegir archivo"), file);
    expect(screen.getByText("contrato.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar como pendiente" }));

    const input = vi.mocked(actions.createPurchaseAction).mock.calls[0]![1];
    expect(input).toMatchObject({ status: "pending" });
    expect(input).not.toHaveProperty("orderedOn");
    const [, orderId, data] = vi.mocked(actions.addOrderDocumentAction).mock.calls[0]!;
    expect(orderId).toBe("order-57");
    expect([data.get("title"), (data.get("file") as File).name]).toEqual(["contrato", "contrato.pdf"]);
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras/order-57");
  });

  it("refuses a PDF over 4 MB in the form", async () => {
    renderScreen();
    const big = new File(["%PDF"], "grande.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });
    await userEvent.upload(screen.getByLabelText("Elegir archivo"), big);
    expect(screen.getByRole("alert")).toHaveTextContent("El archivo supera el máximo de 4 MB.");
    expect(screen.queryByText("grande.pdf")).not.toBeInTheDocument();
  });

  it("keeps the order when its PDF fails, and says so", async () => {
    vi.mocked(actions.addOrderDocumentAction).mockResolvedValue({ error: "file_too_large" });
    renderScreen();
    await fillSubcontract();
    await userEvent.upload(screen.getByLabelText("Elegir archivo"), new File(["%PDF"], "grande.pdf", { type: "application/pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar como pendiente" }));

    const alert = await screen.findByText("PED-057 se ha guardado, pero su documento no se ha subido:");
    expect(alert.closest("[role=alert]")).toHaveTextContent("El archivo supera el máximo de 4 MB.");
    expect(router.push).not.toHaveBeenCalled();
    // Saving again doesn't create a second order.
    await userEvent.click(screen.getByRole("button", { name: "Guardar como pendiente" }));
    expect(actions.createPurchaseAction).toHaveBeenCalledTimes(1);
  });

  it("asks for what is missing before saving, and shows core's errors", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Guardar y marcar pedido" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Elige un proveedor, escribe el concepto");
    expect(actions.createPurchaseAction).not.toHaveBeenCalled();

    vi.mocked(actions.createPurchaseAction).mockResolvedValue({ error: "unknown_line" });
    await fillSubcontract();
    await userEvent.click(screen.getByRole("button", { name: "Guardar y marcar contratado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Una de las partidas ya no está en el presupuesto aceptado.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("edits an order on its values, keeping lines in other chapters", async () => {
    renderScreen({ form: editForm, chapter: undefined });

    expect(screen.getByRole("heading", { level: 1, name: "Editar pedido" })).toBeInTheDocument();
    // Placed: the kind is fixed.
    expect(screen.getByRole("radio", { name: /Subcontrato/ })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Capítulo" })).toHaveValue("06");
    expect(screen.getByRole("textbox", { name: "Importe de 06.05" })).toHaveValue("3120,00");
    expect(screen.queryByLabelText("Elegir archivo")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Capítulo" }), "07");
    expect(screen.getByText("También en el pedido:")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir 07.02" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(actions.updatePurchaseAction).toHaveBeenCalledWith(
      "p-1",
      "order-49",
      expect.objectContaining({
        kind: "material",
        subcontractorId: "sup-liebana",
        orderedOn: "2026-10-03",
        expectedOn: "2026-10-14",
        lines: [
          { lineageId: "lin-0605", amountCents: 312_000, closesLine: true },
          { lineageId: "lin-0702", amountCents: 464_000, closesLine: true },
        ],
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras/order-49");
  });
});
