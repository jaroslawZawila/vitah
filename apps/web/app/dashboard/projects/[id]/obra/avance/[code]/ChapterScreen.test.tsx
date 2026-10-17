// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import messages from "../../../../../../../messages/es.json";
import { chapters, control, detail } from "../../../../../../../test/construction-fixture";
import ChapterScreen from "./ChapterScreen";

vi.mock("../../../../../../actions/construction", () => ({
  startChapterAction: vi.fn(),
  finishChapterAction: vi.fn(),
  correctChapterAction: vi.fn(),
  createIssueAction: vi.fn(),
  updateIssueAction: vi.fn(),
  addIssueFileAction: vi.fn(),
  deleteIssueFileAction: vi.fn(),
}));
vi.mock("../../../../../../actions/obra", () => ({ saveProgressAction: vi.fn() }));
vi.mock("../../../../../../actions/photos", () => ({ addProjectPhotoAction: vi.fn(), deleteProjectPhotoAction: vi.fn() }));
const actions = await import("../../../../../../actions/construction");
const obra = await import("../../../../../../actions/obra");
const photos = await import("../../../../../../actions/photos");

function renderScreen(props: Partial<Parameters<typeof ChapterScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ChapterScreen projectId="p-1" control={control} detail={detail} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const action of [...Object.values(actions), obra.saveProgressAction, photos.addProjectPhotoAction]) {
    (action as Mock).mockReset().mockResolvedValue({ success: true });
  }
});

describe("ChapterScreen", () => {
  it("shows the chapter's dates, hito, cost, issues, photos and history", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Envolvente térmica Thermochip" })).toBeInTheDocument();
    expect(screen.getByText("Capítulo 06 · Hito H4")).toBeInTheDocument();
    expect(screen.getByText("Fin previsto superado · +8 d")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Avance · VTH-26-001" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/avance");

    const dates = within(screen.getByRole("region", { name: "Fechas" }));
    expect(dates.getByText("14/09/2026")).toBeInTheDocument();
    expect(dates.getByText("27 d hasta hoy")).toBeInTheDocument();
    expect(dates.getByText("Simulado")).toBeInTheDocument();

    const hito = within(screen.getByRole("region", { name: /Hito H4/ }));
    expect(hito.getByText("80.792,40 €")).toBeInTheDocument();
    expect(hito.getByText("Este capítulo")).toBeInTheDocument();
    expect(hito.getByText("fin 14/10")).toBeInTheDocument();
    expect(hito.getByText(/Es el último que falta/)).toBeInTheDocument();
    expect(hito.getByRole("link", { name: "Ver en Pagos →" })).toHaveAttribute("href", "/dashboard/projects/p-1/payments/hito-h4");

    const cost = within(screen.getByRole("region", { name: "Coste" }));
    expect(cost.getByText("+440,00 € · +1,4 %")).toBeInTheDocument();
    expect(cost.getByText("· 6 de 9 partidas")).toBeInTheDocument();

    const issues = within(screen.getByRole("region", { name: "Incidencias y cambios" }));
    expect(issues.getByRole("article", { name: "INC-007" })).toBeInTheDocument();
    expect(issues.getByRole("link", { name: "albaran.pdf" })).toHaveAttribute(
      "href",
      "/api/v1/projects/p-1/obra/issues/issue-7/files/file-1",
    );

    const history = within(screen.getByRole("table", { name: "Historial" }));
    expect(history.getByText("Corrección de inicio real")).toBeInTheDocument();
    expect(history.getByText("«El montaje empezó el lunes 21»")).toBeInTheDocument();
    expect(history.getAllByText("22/09/2026")).toHaveLength(2);
  });

  it("saves the lines' executed %, only what changed", async () => {
    renderScreen();

    const pct = screen.getByLabelText("% ejecutado de 06.01");
    await userEvent.clear(pct);
    await userEvent.type(pct, "90");
    await userEvent.click(screen.getByRole("button", { name: "Guardar avance" }));

    expect(obra.saveProgressAction).toHaveBeenCalledWith("p-1", [{ id: "line-1", executedPct: 90 }]);
    expect(await screen.findByText("Avance guardado.")).toBeInTheDocument();
  });

  it("counts a finished chapter's lines as 100 % and locks them", () => {
    const finished = chapters.find((c) => c.code === "05")!;
    renderScreen({ detail: { ...detail, chapter: finished, milestone: null } });

    expect(screen.getByText("Capítulo finalizado: en la app del cliente cuenta como 100 %.")).toBeInTheDocument();
    expect(screen.getByLabelText("% ejecutado de 06.01")).toHaveValue(100);
    expect(screen.getByLabelText("% ejecutado de 06.01")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar avance" })).not.toBeInTheDocument();
  });

  it("finishes the chapter from its page, then offers to go back to Avance", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Finalizar capítulo" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Finalizar y pedir factura" }));

    expect(actions.finishChapterAction).toHaveBeenCalledWith("p-1", "06", "2026-10-17");
    expect(await screen.findByRole("link", { name: "Volver a Avance" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/avance");
  });

  it("corrects the start date", async () => {
    renderScreen();

    await userEvent.click(within(screen.getByRole("region", { name: "Fechas" })).getByRole("button", { name: "Corregir" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Corregir fechas de Envolvente térmica Thermochip" }));
    await userEvent.click(dialog.getByRole("button", { name: "Vaciar Fecha real de inicio" }));
    await userEvent.click(dialog.getByRole("button", { name: "Guardar corrección" }));

    expect(actions.correctChapterAction).toHaveBeenCalledWith("p-1", "06", { actualStart: null });
  });

  it("records an issue on this chapter", async () => {
    vi.mocked(actions.createIssueAction).mockResolvedValue({ success: true, issueId: "issue-9" });
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "+ Registrar" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Registrar incidencia" }));
    expect(dialog.getByLabelText("Capítulo afectado")).toHaveValue("06");
    await userEvent.click(dialog.getByLabelText("Cambio"));
    await userEvent.type(dialog.getByLabelText("Descripción"), "Cambio de color del panel");
    await userEvent.selectOptions(dialog.getByLabelText("Parte relacionada"), "client");
    await userEvent.type(dialog.getByLabelText(/Impacto en plazo/), "2");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar registro" }));

    expect(actions.createIssueAction).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ kind: "change", chapterCode: "06", party: "client", scheduleImpactDays: 2 }),
    );
    expect(actions.addIssueFileAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits an issue and removes an attachment", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Editar INC-007" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Editar registro" }));
    await userEvent.click(dialog.getByRole("button", { name: "Quitar albaran.pdf" }));
    expect(actions.deleteIssueFileAction).toHaveBeenCalledWith("p-1", "issue-7", "file-1");
    await userEvent.selectOptions(dialog.getByLabelText("Estado"), "resolved");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar registro" }));

    expect(actions.updateIssueAction).toHaveBeenCalledWith(
      "p-1",
      "issue-7",
      expect.objectContaining({ status: "resolved", scheduleImpactDays: 3, costImpactCents: null }),
    );
  });

  it("uploads a photo of this chapter", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Subir foto" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Subir foto" }));
    expect(dialog.getByLabelText(/Capítulo/)).toHaveValue("06");
    await userEvent.upload(dialog.getByLabelText(/Arrastra las fotos/), new File(["x"], "panel.jpg", { type: "image/jpeg" }));
    await userEvent.click(dialog.getByRole("button", { name: "Subir" }));

    await waitFor(() => expect(photos.addProjectPhotoAction).toHaveBeenCalled());
    const data = vi.mocked(photos.addProjectPhotoAction).mock.calls[0]![2];
    expect(data.get("chapterCode")).toBe("06");
    expect((data.get("file") as File).name).toBe("panel.jpg");
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByLabelText("% ejecutado de 06.01")).toBeDisabled();
  });
});
