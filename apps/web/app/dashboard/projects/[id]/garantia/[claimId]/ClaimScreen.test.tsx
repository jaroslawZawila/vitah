// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WarrantyClaim } from "@repo/core/contract";
import messages from "../../../../../../messages/es.json";
import ClaimScreen from "./ClaimScreen";

vi.mock("../../../../../actions/warranty", () => ({ updateClaimAction: vi.fn() }));
const { updateClaimAction } = await import("../../../../../actions/warranty");

const claim: WarrantyClaim = {
  id: "c-1",
  number: 3,
  kind: "electrical",
  room: "kitchen",
  description: "Salta el diferencial al encender el horno.",
  urgent: true,
  status: "received",
  visitOn: null,
  answer: null,
  answeredAt: null,
  photoCount: 1,
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  createdBy: "Elena Ruiz",
  photoIds: ["ph-1"],
  events: [
    { id: "e-1", action: "created", at: "2026-11-02T10:00:00.000Z", byClient: true, by: "Elena Ruiz", detail: {} },
    {
      id: "e-2",
      action: "updated",
      at: "2026-11-03T09:00:00.000Z",
      byClient: false,
      by: "Javier Ruiz",
      detail: { status: { from: "received", to: "in_review" }, answer: { from: null, to: "Lo miramos." } },
    },
  ],
};

function renderScreen(props: Partial<Parameters<typeof ClaimScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ClaimScreen projectId="p-1" projectRef="VTH-26-001" claim={claim} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(updateClaimAction).mockReset().mockResolvedValue({ success: true }));

describe("ClaimScreen", () => {
  it("shows what the client sent, its photos and its history, newest first", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "GAR-003" })).toBeInTheDocument();
    expect(screen.getByText("Electricidad · Cocina")).toBeInTheDocument();
    expect(screen.getByText(/Enviada por Elena Ruiz/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Foto 1" })).toHaveAttribute("src", "/api/v1/projects/p-1/warranty/c-1/photos/ph-1?size=thumb");
    expect(screen.getByRole("img", { name: "Foto 1" }).closest("a")).toHaveAttribute("href", "/api/v1/projects/p-1/warranty/c-1/photos/ph-1");
    const steps = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toEqual([
      expect.stringContaining("Estado: Recibida → En revisión · Respuesta: «Lo miramos.»Javier Ruiz"),
      expect.stringContaining("Solicitud enviadaElena Ruiz"),
    ]);
  });

  it("schedules the visit with an answer to the client", async () => {
    renderScreen();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "scheduled");
    await userEvent.type(screen.getByLabelText("Día de la visita"), "2026-12-01");
    await userEvent.type(screen.getByLabelText("Respuesta al cliente"), "Iremos el lunes.");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateClaimAction).toHaveBeenCalledWith("p-1", "c-1", { status: "scheduled", visitOn: "2026-12-01", answer: "Iremos el lunes." });
  });

  it("confirms before turning a claim down, and says why when refused", async () => {
    vi.mocked(updateClaimAction).mockResolvedValue({ error: "reason_required" });
    renderScreen();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "rejected");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    // Nothing goes to the client until it is confirmed.
    expect(updateClaimAction).not.toHaveBeenCalled();
    const dialog = within(await screen.findByRole("alertdialog", { name: "¿No aceptar la solicitud GAR-003?" }));
    await userEvent.click(dialog.getByRole("button", { name: "No aceptar solicitud" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Escribe al cliente por qué no se acepta la solicitud.");
  });

  it("turns a claim down once confirmed and says it was saved", async () => {
    renderScreen();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "rejected");
    await userEvent.type(screen.getByLabelText("Respuesta al cliente"), "Es desgaste.");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No aceptar solicitud" }));

    expect(updateClaimAction).toHaveBeenCalledWith("p-1", "c-1", { status: "rejected", visitOn: null, answer: "Es desgaste." });
    expect(await screen.findByRole("status")).toHaveTextContent("Solicitud guardada.");
  });

  it("saves any other status at once and says it was saved", async () => {
    renderScreen();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "resolved");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Solicitud guardada.");
  });

  it("is read-only for viewers, and closed once the client cancelled it", () => {
    const { unmount } = renderScreen({ canManage: false });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    unmount();

    renderScreen({ claim: { ...claim, status: "cancelled" } });
    expect(screen.getByText("El cliente canceló esta solicitud: ya no se puede cambiar.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });
});
