// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { invoiceDetail, invoiceItem } from "../../../../../test/invoice-fixture";
import InvoiceScreen from "./InvoiceScreen";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard/compras/facturas/inv-148" }));
vi.mock("../../../../actions/purchase-checks", () => ({ recheckDocumentAction: vi.fn(), dismissCheckAction: vi.fn() }));
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

/** The form's idempotency key: sent with every create, so a double click or a retry is one record. */
const A_KEY = expect.stringMatching(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);

/** The `data` a FormData action was called with, and its file. */
const sent = (call: unknown[] | undefined) => {
  const form = call?.[1] as FormData;
  return { data: JSON.parse(String(form.get("data"))), file: form.get("file") };
};

beforeEach(() => {
  for (const action of Object.values(actions)) vi.mocked(action as () => Promise<unknown>).mockReset().mockResolvedValue({ success: true });
  router.push.mockReset();
});

describe("InvoiceScreen", () => {
  it("shows where it stands, its amounts, data, payments, versions and history", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "MSN-2026/148" })).toBeInTheDocument();
    expect(screen.getByText("Factura recibida · VTH-26-001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PED-004" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    expect(screen.getByRole("status")).toHaveTextContent("Vence el 22 oct 2026, en 3 días.");
    expect(screen.getByRole("status")).toHaveTextContent(/Quedan 13\.500,00\s€ por pagar de 28\.500,00\s€\./);

    const amounts = within(screen.getByRole("region", { name: "Importes" }));
    expect(amounts.getByText("IVA (Inversión del sujeto pasivo)")).toBeInTheDocument();
    expect(amounts.getByText("Retención de garantía 5 %")).toBeInTheDocument();
    expect(amounts.getByText("−1.500,00")).toBeInTheDocument();
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
      // With the form's idempotency key: the payment sent twice is recorded once.
      data: { paidOn: "2026-10-19", amountCents: 1_350_000, method: "confirming", reference: "CF-77", idempotencyKey: A_KEY },
      file: proof,
    });
    // The form closes once the action answers.
    await waitFor(() => expect(screen.queryByRole("form", { name: "Registrar pago" })).not.toBeInTheDocument());
  });

  it("sends a refused payment again under the same key, and the next payment under a new one", async () => {
    vi.mocked(actions.createPaymentAction).mockResolvedValueOnce({ error: "exceeds_amount" }).mockResolvedValueOnce({ error: "exceeds_amount" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    const form = () => within(screen.getByRole("form", { name: "Registrar pago" }));
    // The button is back once the last answer is in.
    const pay = async () => userEvent.click(await form().findByRole("button", { name: /Registrar pago de/ }));
    await pay();
    expect(await form().findByRole("alert")).toHaveTextContent("El importe supera lo que queda por pagar o por abonar.");
    await pay();
    // Now it goes in; the form closes.
    await pay();
    await waitFor(() => expect(screen.queryByRole("form", { name: "Registrar pago" })).not.toBeInTheDocument());
    // Another payment is another submission.
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await pay();

    await waitFor(() => expect(actions.createPaymentAction).toHaveBeenCalledTimes(4));
    const keys = vi.mocked(actions.createPaymentAction).mock.calls.map((call) => sent(call).data.idempotencyKey as string);
    expect(keys[0]).toEqual(A_KEY);
    // Refused, so nothing was paid: sent again as it was, it is the same payment.
    expect([keys[1], keys[2]]).toEqual([keys[0], keys[0]]);
    expect(keys[3]).toEqual(A_KEY);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it("takes a payment back, adds a version of the PDF and deletes the invoice", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Quitar el pago del 15 oct 2026" }));
    // Each confirmation names the record and says what happens: it leaves the lists and totals, an admin can restore it.
    let dialog = within(await screen.findByRole("alertdialog", { name: /^¿Quitar el pago de 15\.000,00\s€ del 15 oct 2026\?$/ }));
    expect(
      dialog.getByText(/^Es un pago de la factura MSN-2026\/148 de Montajes Steel Norte S\.L\.\. .*la factura vuelve a deber ese importe\. Un administrador puede restaurarlo desde Elementos eliminados\.$/),
    ).toBeInTheDocument();
    expect(actions.deletePaymentAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Quitar pago" }));
    expect(actions.deletePaymentAction).toHaveBeenCalledWith("pay-1");
    // Its button is disabled while the action runs.
    await waitFor(() => expect(screen.getByRole("button", { name: "Quitar el pago del 15 oct 2026" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "+ Nueva versión" }));
    const upload = within(screen.getByRole("form", { name: "+ Nueva versión" }));
    const pdf = new File(["%PDF"], "v3.pdf", { type: "application/pdf" });
    await userEvent.upload(upload.getByLabelText("Elegir archivo"), pdf);
    await userEvent.type(upload.getByLabelText("Motivo (opcional)"), "Importe corregido");
    await userEvent.click(upload.getByRole("button", { name: "Subir versión" }));
    const form = vi.mocked(actions.addInvoiceFileAction).mock.calls[0]?.[1] as FormData;
    expect([form.get("file"), form.get("note")]).toEqual([pdf, "Importe corregido"]);
    // The form closes once the version is in.
    await waitFor(() => expect(screen.queryByRole("form", { name: "+ Nueva versión" })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    dialog = within(await screen.findByRole("alertdialog", { name: "¿Eliminar la factura MSN-2026/148 de Montajes Steel Norte S.L.?" }));
    expect(dialog.getByText("Sale de las listas y de los totales, con sus PDF. Un administrador puede restaurarla desde Elementos eliminados.")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Eliminar factura" }));
    expect(actions.deleteInvoiceAction).toHaveBeenCalledWith("inv-148");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/compras/facturas"));
  });

  it("links a credit note on it, and shows a paid one's retention; read-only for viewers", () => {
    const { unmount } = renderScreen();
    expect(screen.getByRole("link", { name: "Registrar abono" })).toHaveAttribute("href", "/dashboard/compras/facturas/nueva?pedido=order-4&abono=inv-148");
    unmount();

    renderScreen({
      canManage: false,
      invoice: { ...invoiceDetail, ...invoiceItem({ state: "paid", paidCents: 2_850_000, outstandingCents: 0 }), payableLeftCents: 150_000 },
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Factura pagada\. .*Siguen retenidos 1.500,00\s€ hasta el fin de la garantía\./);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
  });
});

describe("InvoiceScreen with the AI's review of its PDF and proofs", () => {
  it("shows each review, a duplicate linking to the other invoice", () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
        <InvoiceScreen
          invoice={{
            ...invoiceDetail,
            checks: [
              {
                id: "chk-9",
                subject: "invoice_file",
                label: "MSN-2026/148 · v1",
                status: "done",
                findings: [{ kind: "duplicate", detail: null, duplicate: { label: "MSN-2026/112 · v1", orderId: "order-4", projectId: "p-1", invoiceId: "inv-112" } }],
                reason: null,
                checkedAt: "2026-09-24T10:00:00.000Z",
                dismissedAt: null,
                dismissedBy: null,
              },
              { id: "chk-10", subject: "payment_proof", label: "Justificante.pdf", status: "done", findings: [], reason: null, checkedAt: "2026-10-15T10:00:00.000Z", dismissedAt: null, dismissedBy: null },
            ],
          }}
          canManage
        />
      </NextIntlClientProvider>,
    );
    const card = within(screen.getByRole("region", { name: "Revisión de documentos con IA" }));
    expect(card.getByText("PDF de la factura")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "MSN-2026/112 · v1" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-112");
    expect(card.getByText("Justificante de pago")).toBeInTheDocument();
    expect(card.getByText("Sin avisos")).toBeInTheDocument();
  });
});
