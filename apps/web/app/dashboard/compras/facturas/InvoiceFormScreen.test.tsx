// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import { invoiceDetail, invoiceForm } from "../../../../test/invoice-fixture";
import InvoiceFormScreen from "./InvoiceFormScreen";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard/compras/facturas/nueva" }));
vi.mock("../../../actions/purchase-invoices", () => ({ createInvoiceAction: vi.fn(), updateInvoiceAction: vi.fn() }));
const actions = await import("../../../actions/purchase-invoices");

function renderScreen(props: Partial<Parameters<typeof InvoiceFormScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <InvoiceFormScreen form={invoiceForm} {...props} />
    </NextIntlClientProvider>,
  );
}

const summary = () => within(screen.getByRole("complementary", { name: "Resumen" }));
const created = () => {
  const call = vi.mocked(actions.createInvoiceAction).mock.calls[0];
  const form = call?.[1] as FormData;
  return { args: call?.slice(0, 1), data: JSON.parse(String(form.get("data"))), file: form.get("file") };
};

beforeEach(() => {
  vi.mocked(actions.createInvoiceAction).mockReset().mockResolvedValue({ success: true, invoiceId: "inv-171" });
  vi.mocked(actions.updateInvoiceAction).mockReset().mockResolvedValue({ success: true });
  router.push.mockReset();
  router.replace.mockReset();
});

describe("InvoiceFormScreen", () => {
  it("registers an invoice on the order's next milestone, with its terms, PDF and live totals", async () => {
    renderScreen();

    expect(screen.getByRole("combobox", { name: "Proveedor" })).toHaveValue("sup-msn");
    expect(screen.getByRole("combobox", { name: "Obra y pedido" })).toHaveValue("order-4");
    const third = screen.getByRole("radio", { name: /Fin de montaje/ });
    expect(third).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Entrega en obra/ })).toBeDisabled();
    expect(screen.getByLabelText("Base imponible (€)")).toHaveValue("27.000,00");
    expect(screen.getByLabelText("Vence")).toHaveValue("2026-11-18");
    expect(screen.getByRole("button", { name: "Inversión del sujeto pasivo" })).toHaveAttribute("aria-pressed", "true");
    expect(summary().getByText("−1350,00")).toBeInTheDocument();
    expect(summary().getByText("25.650,00")).toBeInTheDocument();
    expect(summary().getByText("Quedarán 1200,00 por facturar.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "21 %" }));
    expect(summary().getByText("5670,00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Inversión del sujeto pasivo" }));
    await userEvent.type(screen.getByLabelText("Nº de factura del proveedor"), "MSN-2026/171");
    const pdf = new File(["%PDF"], "MSN-171.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Elegir archivo"), pdf);
    await userEvent.click(summary().getByRole("button", { name: "Registrar factura" }));

    expect(created()).toEqual({
      args: ["order-4"],
      data: {
        number: "MSN-2026/171",
        issuedOn: "2026-10-19",
        dueOn: "2026-11-18",
        notes: null,
        kind: "invoice",
        milestoneId: "m-3",
        baseCents: 2_700_000,
        vatKind: "reverse_charge",
        irpfBp: 0,
        retentionBp: 500,
      },
      file: pdf,
    });
    expect(router.push).toHaveBeenCalledWith("/dashboard/compras/facturas/inv-171");
  });

  it("splits by line in proportion unless typed, and refuses a split that doesn't add up", async () => {
    renderScreen();
    const split = within(screen.getByRole("region", { name: "4 · Reparto por partidas" }));
    expect(split.getByLabelText("Importe de 03.01 en esta factura")).toHaveValue("25.137,93");
    expect(split.getByLabelText("Importe de 03.02 en esta factura")).toHaveValue("1862,07");

    const second = split.getByLabelText("Importe de 03.02 en esta factura");
    await userEvent.clear(second);
    await userEvent.type(second, "1000");
    expect(split.getByRole("alert")).toHaveTextContent("El reparto suma 26.137,93 y la base es 27.000,00.");
    await userEvent.type(screen.getByLabelText("Nº de factura del proveedor"), "X-1");
    expect(summary().getByRole("button", { name: "Registrar factura" })).toBeDisabled();

    const first = split.getByLabelText("Importe de 03.01 en esta factura");
    await userEvent.clear(first);
    await userEvent.type(first, "26000");
    await userEvent.click(summary().getByRole("button", { name: "Registrar factura" }));
    expect(created().data.lines).toEqual([
      { lineageId: "lin-0301", amountCents: 2_600_000 },
      { lineageId: "lin-0302", amountCents: 100_000 },
    ]);
  });

  it("takes a line left blank as nothing", async () => {
    renderScreen();
    const split = within(screen.getByRole("region", { name: "4 · Reparto por partidas" }));
    await userEvent.clear(split.getByLabelText("Importe de 03.02 en esta factura"));
    const first = split.getByLabelText("Importe de 03.01 en esta factura");
    await userEvent.clear(first);
    await userEvent.type(first, "27000");
    await userEvent.type(screen.getByLabelText("Nº de factura del proveedor"), "X-2");
    await userEvent.click(summary().getByRole("button", { name: "Registrar factura" }));
    expect(created().data.lines).toEqual([{ lineageId: "lin-0301", amountCents: 2_700_000 }]);
  });

  it("keeps an edited invoice's own split", () => {
    const custom = {
      ...invoiceDetail,
      payments: [],
      lines: [{ lineageId: "lin-0302", chapterCode: "03", code: "03.02", description: "Ingeniería y modelo BIM", amountCents: 3_000_000 }],
    };
    renderScreen({ form: { ...invoiceForm, editing: custom } });
    const split = within(screen.getByRole("region", { name: "4 · Reparto por partidas" }));
    expect(split.getByLabelText("Importe de 03.01 en esta factura")).toHaveValue("0,00");
    expect(split.getByLabelText("Importe de 03.02 en esta factura")).toHaveValue("30.000,00");
  });

  it("registers a credit note on one of the order's invoices", async () => {
    renderScreen({ rectifiesId: "inv-148" });
    expect(screen.getByRole("heading", { level: 1, name: "Registrar abono" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rectifica a" })).toHaveValue("inv-148");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nº de abono del proveedor"), "MSN-R08");
    await userEvent.type(screen.getByLabelText("Importe a abonar, sin IVA (€)"), "1200");
    expect(summary().getByText("Reduce lo que se debe de MSN-2026/148.")).toBeInTheDocument();
    await userEvent.click(summary().getByRole("button", { name: "Registrar abono" }));

    expect(created().data).toMatchObject({ kind: "credit_note", rectifiesId: "inv-148", baseCents: -120_000, retentionBp: 500 });
    expect(created().data).not.toHaveProperty("dueOn");
  });

  it("picks another order by reloading on it", async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "sup-soc");
    expect(router.replace).toHaveBeenCalledWith("/dashboard/compras/facturas/nueva");
  });

  it("edits only the number, dates and notes of an invoice with payments", async () => {
    renderScreen({ form: { ...invoiceForm, editing: invoiceDetail } });
    expect(screen.getByRole("heading", { level: 1, name: "Editar factura" })).toBeInTheDocument();
    expect(screen.getByText("Ya tiene pagos: solo se pueden cambiar el número, las fechas y las notas.")).toBeInTheDocument();
    expect(screen.getByLabelText("Base imponible (€)")).toBeDisabled();
    const number = screen.getByLabelText("Nº de factura del proveedor");
    await userEvent.clear(number);
    await userEvent.type(number, "MSN-2026/148-B");
    await userEvent.click(summary().getByRole("button", { name: "Guardar cambios" }));

    expect(actions.updateInvoiceAction).toHaveBeenCalledWith("inv-148", {
      number: "MSN-2026/148-B",
      issuedOn: "2026-09-22",
      dueOn: "2026-10-22",
      notes: null,
    });
    expect(router.push).toHaveBeenCalledWith("/dashboard/compras/facturas/inv-148");
  });
});
