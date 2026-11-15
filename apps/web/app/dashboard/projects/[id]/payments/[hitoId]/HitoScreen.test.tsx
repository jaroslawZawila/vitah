// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { HitoEvent } from "@repo/core/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { hito, hitos } from "../../../../../../test/obra-fixture";
import HitoScreen from "./HitoScreen";

vi.mock("../../../../../actions/obra", () => ({
  updateHitoAction: vi.fn(),
  addCheckAction: vi.fn(),
  updateCheckAction: vi.fn(),
  deleteCheckAction: vi.fn(),
  setActaPhotosAction: vi.fn(),
  uploadHitoFileAction: vi.fn(),
  removeHitoFileAction: vi.fn(),
  registerPaymentAction: vi.fn(),
  cancelPaymentAction: vi.fn(),
}));
const actions = await import("../../../../../actions/obra");

const photos = [
  { id: "ph-1", caption: "Estructura", sizeBytes: 1, uploadedAt: "2026-09-20T10:00:00Z", uploadedBy: "Laura", chapterCode: null, takenOn: "2026-09-20", visibleToClient: true },
  { id: "ph-2", caption: "Cubierta", sizeBytes: 1, uploadedAt: "2026-09-21T10:00:00Z", uploadedBy: "Laura", chapterCode: null, takenOn: "2026-09-21", visibleToClient: true },
];
const h3 = hitos.find((h) => h.code === "H3")!;

function renderScreen(props: Partial<Parameters<typeof HitoScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <HitoScreen projectId="p-1" projectRef="VTH-26-001" hito={hito()} events={[]} today="2026-10-20" photos={photos} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(actions)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
});

describe("HitoScreen", () => {
  it("shows the hito's pipeline, conditions and amounts", () => {
    renderScreen({ hito: h3 });

    expect(screen.getByRole("heading", { name: "Estructura Steel Frame" })).toBeInTheDocument();
    expect(screen.getByText("VTH-26-001 · Hito H3 · 15 %")).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Estado del hito" }));
    expect(steps.getByText("Pagado").closest("li")).toHaveAttribute("aria-current", "step");
    expect(steps.getByText("Vence el 1 oct 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acta de conformidad H3 \(firmada\)/ })).toHaveAttribute("href", "/api/v1/projects/p-1/hitos/hito-h3/files/acta");
    expect(screen.getByRole("link", { name: /Factura H3/ })).toHaveAttribute("href", "/api/v1/projects/p-1/hitos/hito-h3/files/invoice");
    expect(screen.getByText(/Vence el 1 oct 2026: 5 días hábiles/)).toBeInTheDocument();
    expect(screen.getByLabelText("Importe cobrado (€)")).toHaveValue("73.953,83");
  });

  it("ticks, adds and removes conditions", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("checkbox", { name: "Prueba de estanqueidad provisional" }));
    expect(actions.updateCheckAction).toHaveBeenCalledWith("p-1", "check-1", { done: true });

    await userEvent.type(screen.getByLabelText("Nueva condición"), "Persianas motorizadas");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(actions.addCheckAction).toHaveBeenCalledWith("p-1", "hito-h4", "Persianas motorizadas");

    await userEvent.click(screen.getByRole("button", { name: "Quitar «Prueba de estanqueidad provisional»" }));
    expect(actions.deleteCheckAction).toHaveBeenCalledWith("p-1", "check-1");
  });

  it("picks the acta's photos", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Elegir fotos" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Fotos del acta" }));
    await userEvent.click(dialog.getByRole("checkbox", { name: "Cubierta" }));
    await userEvent.click(dialog.getByRole("button", { name: "Guardar selección" }));
    expect(actions.setActaPhotosAction).toHaveBeenCalledWith("p-1", "hito-h4", ["ph-2"]);
  });

  it("uploads the signed acta", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Subir acta firmada" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Subir acta firmada" }));
    await userEvent.upload(dialog.getByLabelText("Archivo PDF"), new File(["%PDF-"], "acta.pdf", { type: "application/pdf" }));
    fireEvent.change(dialog.getByLabelText("Fecha de firma"), { target: { value: "2026-10-20" } });
    fireEvent.submit(dialog.getByRole("button", { name: "Subir" }).closest("form")!);

    await vi.waitFor(() => expect(actions.uploadHitoFileAction).toHaveBeenCalled());
    const [projectId, hitoId, kind, , form] = vi.mocked(actions.uploadHitoFileAction).mock.calls[0]!;
    expect([projectId, hitoId, kind]).toEqual(["p-1", "hito-h4", "acta"]);
    expect((form as FormData).get("date")).toBe("2026-10-20");
  });

  it("records and undoes the payment", async () => {
    renderScreen({ hito: h3 });

    fireEvent.change(screen.getByLabelText("Fecha de cobro"), { target: { value: "2026-09-30" } });
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    expect(actions.registerPaymentAction).toHaveBeenCalledWith("p-1", "hito-h3", { paidOn: "2026-09-30", amountCents: 7_395_383 });

    renderScreen({ hito: { ...h3, status: "paid", paidOn: "2026-09-30", paidAmountCents: 7_395_383 } });
    expect(screen.getByText("Pagado el 30 sept 2026 · 73.953,83 €")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Anular pago" }));
    // Names the payment and says it stays in the history.
    const dialog = within(await screen.findByRole("alertdialog", { name: "¿Anular el pago del H3?" }));
    expect(
      dialog.getByText(/Se anula el cobro de 73\.953,83 € del 30 sept 2026: el hito vuelve a constar como no pagado.*El pago queda en el historial del hito\./),
    ).toBeInTheDocument();
    expect(actions.cancelPaymentAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Anular pago" }));
    expect(actions.cancelPaymentAction).toHaveBeenCalledWith("p-1", "hito-h3");
  });

  it("takes the signed acta off only once confirmed", async () => {
    renderScreen({ hito: h3 });

    await userEvent.click(screen.getAllByRole("button", { name: "Quitar" })[0]!);
    const dialog = within(await screen.findByRole("alertdialog", { name: "¿Quitar el acta firmada del H3?" }));
    expect(dialog.getByText(/El PDF se conserva y la retirada queda en el historial del hito\./)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actions.removeHitoFileAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole("button", { name: "Quitar" })[0]!);
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Quitar acta" }));
    expect(actions.removeHitoFileAction).toHaveBeenCalledWith("p-1", "hito-h3", "acta");
  });

  it("takes no payment dated after today", () => {
    renderScreen({ hito: h3 });
    expect(screen.getByLabelText("Fecha de cobro")).toHaveAttribute("max", "2026-10-20");
  });

  it("shows the history: what was registered, corrected and cancelled, when and by whom", () => {
    // Newest first, as core gives them.
    const events: HitoEvent[] = [
      { id: "e-7", at: "2026-10-05T08:15:00.000Z", userName: null, action: "invoice_removed", detail: { date: "2026-09-24", sizeBytes: 2 * 1024 * 1024 } },
      { id: "e-6", at: "2026-10-03T09:00:00.000Z", userName: "Ana Admin", action: "payment_cancelled", detail: { paidOn: "2026-10-01", amountCents: 7_000_000 } },
      { id: "e-5", at: "2026-10-02T16:40:00.000Z", userName: "Ana Admin", action: "payment_registered", detail: { paidOn: "2026-10-01", amountCents: 7_000_000, previous: { paidOn: "2026-09-30", amountCents: 7_395_383 } } },
      { id: "e-4", at: "2026-09-30T10:05:00.000Z", userName: "Laura Gestora", action: "payment_registered", detail: { paidOn: "2026-09-30", amountCents: 7_395_383, previous: null } },
      { id: "e-3", at: "2026-09-25T10:00:00.000Z", userName: "Laura Gestora", action: "invoice_uploaded", detail: { date: "2026-09-24", sizeBytes: 2 * 1024 * 1024, previous: null } },
      { id: "e-2", at: "2026-09-24T22:30:00.000Z", userName: "Laura Gestora", action: "acta_uploaded", detail: { date: "2026-09-24", sizeBytes: 350 * 1024, previous: { date: "2026-09-23", sizeBytes: 340 * 1024 } } },
      { id: "e-1", at: "2026-09-23T12:00:00.000Z", userName: "Laura Gestora", action: "acta_uploaded", detail: { date: "2026-09-23", sizeBytes: 340 * 1024, previous: null } },
    ];
    renderScreen({ hito: h3, events });

    const rows = within(screen.getByRole("list", { name: "Historial" })).getAllByRole("listitem");
    // Intl puts a no-break space before the € sign.
    expect(rows.map((row) => row.textContent?.replace(/\u00a0/g, " "))).toEqual([
      "5 oct 2026, 10:15Factura quitada: emitida el 24 sept 2026 (2 MB)",
      "3 oct 2026, 11:00Pago anulado: 70.000,00 €, cobrado el 1 oct 2026 · Ana Admin",
      "2 oct 2026, 18:40Pago corregido: 70.000,00 €, cobrado el 1 oct 2026. Antes: 73.953,83 €, cobrado el 30 sept 2026 · Ana Admin",
      "30 sept 2026, 12:05Pago registrado: 73.953,83 €, cobrado el 30 sept 2026 · Laura Gestora",
      "25 sept 2026, 12:00Factura subida: emitida el 24 sept 2026 (2 MB) · Laura Gestora",
      // 22:30 UTC is already the 25th in Spain.
      "25 sept 2026, 00:30Acta firmada sustituida: firmada el 24 sept 2026 (350 kB). Antes: firmada el 23 sept 2026 (340 kB) · Laura Gestora",
      "23 sept 2026, 14:00Acta firmada subida: firmada el 23 sept 2026 (340 kB) · Laura Gestora",
    ]);
  });

  it("says so when nothing has been recorded yet", () => {
    renderScreen();
    expect(within(screen.getByRole("region", { name: "Historial" })).getByText("Todavía no hay nada registrado.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Historial" })).not.toBeInTheDocument();
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.getByRole("checkbox", { name: "Prueba de estanqueidad provisional" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Subir acta firmada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
  });
});
