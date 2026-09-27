// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
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
  { id: "ph-1", caption: "Estructura", sizeBytes: 1, uploadedAt: "2026-09-20T10:00:00Z", uploadedBy: "Laura" },
  { id: "ph-2", caption: "Cubierta", sizeBytes: 1, uploadedAt: "2026-09-21T10:00:00Z", uploadedBy: "Laura" },
];
const h3 = hitos.find((h) => h.code === "H3")!;

function renderScreen(props: Partial<Parameters<typeof HitoScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <HitoScreen projectId="p-1" projectRef="VTH-26-001" hito={hito()} photos={photos} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(actions)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
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
    expect(actions.cancelPaymentAction).toHaveBeenCalledWith("p-1", "hito-h3");
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.getByRole("checkbox", { name: "Prueba de estanqueidad provisional" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Subir acta firmada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).not.toBeInTheDocument();
  });
});
