// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { chapter, hito } from "../../../../../../test/obra-fixture";
import ChapterScreen from "./ChapterScreen";

vi.mock("../../../../../actions/obra", () => ({ saveProgressAction: vi.fn() }));
vi.mock("../../../../../actions/photos", () => ({ addProjectPhotoAction: vi.fn() }));
const actions = await import("../../../../../actions/obra");

const photo = { id: "ph-1", caption: "Paneles", sizeBytes: 1, uploadedAt: "2026-09-25T10:00:00Z", uploadedBy: "Laura" };

function renderScreen(props: Partial<Parameters<typeof ChapterScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ChapterScreen
        projectId="p-1"
        projectRef="VTH-26-001"
        chapter={chapter()}
        hito={hito()}
        photos={[photo]}
        canManage
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(actions.saveProgressAction).mockReset());

describe("ChapterScreen", () => {
  it("shows the chapter's lines, progress, hito and photos", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Envolvente Térmica — Paneles Thermochip" })).toBeInTheDocument();
    expect(screen.getByText("VTH-26-001 · Capítulo 05")).toBeInTheDocument();
    expect(screen.getByText(/35\.056,03 € · 19,26 % del PEC · 2 partidas · se cierra con el hito H4/)).toBeInTheDocument();

    const row = screen.getByText("Barrera de vapor Blowerproof").closest("[role=row]") as HTMLElement;
    expect(within(row).getByRole("spinbutton", { name: "Ejecutado de 05.03 en %" })).toHaveValue(60);
    expect(within(row).getByText("3337,17 €")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Hito H4 · Envolvente estanca/ })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/payments/hito-h4",
    );
    expect(screen.getByRole("img", { name: "Paneles" })).toHaveAttribute(
      "src",
      "/api/v1/projects/p-1/photos/ph-1?size=thumb",
    );
  });

  it("saves the changed lines", async () => {
    vi.mocked(actions.saveProgressAction).mockResolvedValue({ success: true });
    renderScreen();

    const input = screen.getByRole("spinbutton", { name: "Ejecutado de 05.03 en %" });
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    // The chapter's own figure follows as you type.
    const card = screen.getByText("Avance del capítulo").parentElement!;
    expect(within(card).getByText("100 %")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar avance" }));

    expect(actions.saveProgressAction).toHaveBeenCalledWith("p-1", [{ id: "line-2", executedPct: 100 }]);
    expect(await screen.findByText("Avance guardado.")).toBeInTheDocument();
  });

  it("shows why a save failed", async () => {
    vi.mocked(actions.saveProgressAction).mockResolvedValue({ error: "not_accepted" });
    renderScreen();

    const input = screen.getByRole("spinbutton", { name: "Ejecutado de 05.01 en %" });
    await userEvent.clear(input);
    await userEvent.type(input, "90");
    await userEvent.click(screen.getByRole("button", { name: "Guardar avance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/revisión aceptada/);
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.getByRole("spinbutton", { name: "Ejecutado de 05.01 en %" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar avance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir fotos" })).not.toBeInTheDocument();
  });
});
