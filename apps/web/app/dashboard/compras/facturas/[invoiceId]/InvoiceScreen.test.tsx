// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { invoiceDetail, invoiceItem } from "../../../../../test/invoice-fixture";
import InvoiceScreen from "./InvoiceScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard/compras/facturas/inv-148" }));
vi.mock("../../../../actions/purchase-invoices", () => ({
  addInvoiceFileAction: vi.fn(),
  createPaymentAction: vi.fn(),
  deleteInvoiceAction: vi.fn(),
  deletePaymentAction: vi.fn(),
}));
const actions = await import("../../../../actions/purchase-invoices");

function renderScreen(props: Partial<Parameters<typeof InvoiceScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <InvoiceScreen invoice={invoiceDetail} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

/** The `data` a FormData action was called with, and its file. */
const sent = (call: unknown[] | undefined) => {
  const form = call?.[1] as FormData;
  return { data: JSON.parse(String(form.get("data"))), file: form.get("file") };
};

beforeEach(() => {
  for (const action of Object.values(actions)) vi.mocked(action as () => Promise<unknown>).mockReset().mockResolvedValue({ success: true });
  router.push.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("InvoiceScreen", () => {
  it("shows where it stands, its amounts, data, payments, versions and history", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "MSN-2026/148" })).toBeInTheDocument();
    expect(screen.getByText("Factura recibida · VTH-26-001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PED-004" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    expect(screen.getByRole("status")).toHaveTextContent("Vence el 22 oct, en 3 días.");
    expect(screen.getByRole("status")).toHaveTextContent(/Quedan 13\.500,00\s€ por pagar de 28\.500,00\s€\./);

    const amounts = within(screen.getByRole("region", { name: "Importes" }));
    expect(amounts.getByText("IVA (Inversión del sujeto pasivo)")).toBeInTheDocument();
    expect(amounts.getByText("Retención de garantía 5 %")).toBeInTheDocument();
    expect(amounts.getByText("−1500,00")).toBeInTheDocument();
    expect(amounts.getByText("28.500,00")).toBeInTheDocument();

    const data = within(screen.getByRole("region", { name: "Datos" }));
    expect(data.getByText("Entrega en obra")).toBeInTheDocument();
    expect(data.getByText("03.01")).toBeInTheDocument();

    const files = within(screen.getByRole("region", { name: "Documentos" }));
    expect(files.getByText("v2 · vigente")).toBeInTheDocument();
    expect(files.getAllByRole("link", { name: "MSN-2026-148.pdf" }).map((a) => a.getAttribute("href"))).toEqual([
      "/api/v1/purchases/invoices/inv-148/file",
      "/api/v1/purchases/invoices/inv-148/file?fileId=f-1",
    ]);
    expect(files.getByText(/sustituida: «Faltaba el nº de pedido»/)).toBeInTheDocument();

    const history = within(screen.getByRole("region", { name: "Historial" }));
    expect(history.getByText("Pago de 15.000,00 € a MSN-2026/148")).toBeInTheDocument();
  });

  it("records a payment with its proof, what is owed by default", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    const form = within(screen.getByRole("form", { name: "Registrar pago" }));
    expect(form.getByLabelText("Importe (€)")).toHaveValue("13.500,00");
    expect(form.getByLabelText("Fecha")).toHaveAttribute("max", "2026-10-19");
    await userEvent.selectOptions(form.getByLabelText("Forma de pago"), "confirming");
    await userEvent.type(form.getByLabelText("Referencia (opcional)"), "CF-77");
    const proof = new File(["%PDF"], "aviso.pdf", { type: "application/pdf" });
    await userEvent.upload(form.getByLabelText("Elegir archivo"), proof);
    await userEvent.click(form.getByRole("button", { name: /Registrar pago de 13\.500,00/ }));

    const call = vi.mocked(actions.createPaymentAction).mock.calls[0];
    expect(call?.[0]).toBe("inv-148");
    expect(sent(call)).toEqual({
      data: { paidOn: "2026-10-19", amountCents: 1_350_000, method: "confirming", reference: "CF-77" },
      file: proof,
    });
    expect(screen.queryByRole("form", { name: "Registrar pago" })).not.toBeInTheDocument();
  });

  it("takes a payment back, adds a version of the PDF and deletes the invoice", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Quitar el pago del 15 oct" }));
    expect(actions.deletePaymentAction).toHaveBeenCalledWith("pay-1");

    await userEvent.click(screen.getByRole("button", { name: "+ Nueva versión" }));
    const upload = within(screen.getByRole("form", { name: "+ Nueva versión" }));
    const pdf = new File(["%PDF"], "v3.pdf", { type: "application/pdf" });
    await userEvent.upload(upload.getByLabelText("Elegir archivo"), pdf);
    await userEvent.type(upload.getByLabelText("Motivo (opcional)"), "Importe corregido");
    await userEvent.click(upload.getByRole("button", { name: "Subir versión" }));
    const form = vi.mocked(actions.addInvoiceFileAction).mock.calls[0]?.[1] as FormData;
    expect([form.get("file"), form.get("note")]).toEqual([pdf, "Importe corregido"]);

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(actions.deleteInvoiceAction).toHaveBeenCalledWith("inv-148");
    expect(router.push).toHaveBeenCalledWith("/dashboard/compras/facturas");
  });

  it("links a credit note on it, and shows a paid one's retention; read-only for viewers", () => {
    const { unmount } = renderScreen();
    expect(screen.getByRole("link", { name: "Registrar abono" })).toHaveAttribute("href", "/dashboard/compras/facturas/nueva?pedido=order-4&abono=inv-148");
    unmount();

    renderScreen({
      canManage: false,
      invoice: { ...invoiceDetail, ...invoiceItem({ state: "paid", paidCents: 2_850_000, outstandingCents: 0 }), payableLeftCents: 150_000 },
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Factura pagada\. .*Siguen retenidos 1500,00\s€ hasta el fin de la garantía\./);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
  });
});
