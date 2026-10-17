// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import messages from "../../../../../../messages/es.json";
import { control, header } from "../../../../../../test/construction-fixture";
import AvanceScreen from "./AvanceScreen";

vi.mock("../../../../../actions/construction", () => ({
  startChapterAction: vi.fn(),
  finishChapterAction: vi.fn(),
  correctChapterAction: vi.fn(),
  createIssueAction: vi.fn(),
  updateIssueAction: vi.fn(),
  addIssueFileAction: vi.fn(),
  deleteIssueFileAction: vi.fn(),
}));
vi.mock("../../../../../actions/photos", () => ({ addProjectPhotoAction: vi.fn(), deleteProjectPhotoAction: vi.fn() }));
const actions = await import("../../../../../actions/construction");

function renderScreen(props: Partial<Parameters<typeof AvanceScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <AvanceScreen projectId="p-1" header={header} control={control} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

/** The table (from 768px); the phone cards repeat the same buttons. */
const table = () => within(screen.getByRole("region", { name: "Capítulos y fechas" }));

beforeEach(() => {
  for (const action of Object.values(actions)) (action as Mock).mockReset().mockResolvedValue({ success: true });
  // The finish asks for the hito's invoice when it was the last chapter.
  vi.mocked(actions.finishChapterAction).mockResolvedValue({ success: true, invoiceRequested: "H4" });
});

describe("AvanceScreen", () => {
  it("shows each chapter's plan against what happened", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Avance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Avance", current: "page" })).toBeInTheDocument();
    const filter = within(screen.getByRole("group", { name: "Estado" }));
    expect(filter.getByRole("button", { name: /En curso\s*2/ })).toHaveAttribute("aria-pressed", "false");

    const row = table().getByRole("link", { name: "Envolvente térmica Thermochip" }).closest("tr")!;
    expect(within(row).getByText("Fin previsto superado · +8 d")).toBeInTheDocument();
    expect(within(row).getByText("1 incidencia")).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "Plan 14/09 a 09/10, real desde 21/09" })).toBeInTheDocument();
    const done = table().getByRole("link", { name: "Carpintería exterior e interior" }).closest("tr")!;
    expect(within(done).getByText("23 d · plan 19 d")).toBeInTheDocument();
    expect(within(done).getByRole("img", { name: "Plan 21/09 a 09/10, real 22/09 a 14/10" })).toBeInTheDocument();
    expect(table().getByText("empieza el 19/10 según plan")).toBeInTheDocument();
    // Planning's dates are simulated.
    expect(screen.getAllByText("Simulado").length).toBeGreaterThan(0);

    const recent = within(screen.getByRole("region", { name: "Últimos registros" }));
    expect(recent.getByText("Fin real 10")).toBeInTheDocument();
    expect(recent.getByText("Admin ViTAH · «La teja de cumbrera se remató el 9»")).toBeInTheDocument();
  });

  it("filters by state", async () => {
    renderScreen();
    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: /Pendiente/ }));
    expect(table().getAllByRole("link").map((l) => l.textContent)).toEqual(["Electricidad e iluminación", "Climatización y VMC"]);
  });

  it("starts a chapter on the day given", async () => {
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Iniciar 13" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Iniciar Electricidad e iluminación" }));
    const date = dialog.getByLabelText("Fecha real de inicio");
    expect(date).toHaveValue("2026-10-17");
    expect(date).toHaveAttribute("max", "2026-10-17");
    fireEvent.change(date, { target: { value: "2026-10-15" } });
    await userEvent.click(dialog.getByRole("button", { name: "Iniciar" }));

    expect(actions.startChapterAction).toHaveBeenCalledWith("p-1", "13", "2026-10-15");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says what the server did: no request when someone else's finish already made it", async () => {
    vi.mocked(actions.finishChapterAction).mockResolvedValue({ success: true, invoiceRequested: null });
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Finalizar 06" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Finalizar Envolvente térmica Thermochip" }));
    await userEvent.click(dialog.getByRole("button", { name: "Finalizar y pedir factura" }));

    const done = within(await screen.findByRole("status"));
    expect(done.getByText("Capítulo 06 finalizado")).toBeInTheDocument();
    expect(done.queryByText("Factura solicitada")).not.toBeInTheDocument();
  });

  it("finishing the last chapter of a hito shows the invoice it will request", async () => {
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Finalizar 06" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Finalizar Envolvente térmica Thermochip" }));
    expect(dialog.getByText("Con esto se cumple el hito H4 · Envolvente estanca")).toBeInTheDocument();
    expect(dialog.getByText("Marta Ruiz Gómez")).toBeInTheDocument();
    expect(dialog.getByText("H4 Envolvente estanca (cap. 05, 06, 10)")).toBeInTheDocument();
    expect(dialog.getByText("80.792,40 €")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Finalizar y pedir factura" }));

    expect(actions.finishChapterAction).toHaveBeenCalledWith("p-1", "06", "2026-10-17");
    const done = within(await screen.findByRole("status"));
    expect(done.getByText("Capítulo 06 finalizado")).toBeInTheDocument();
    expect(done.getByText("Factura solicitada")).toBeInTheDocument();
    expect(done.getByText("17/10/2026 · 27 d")).toBeInTheDocument();
  });

  it("finishes a chapter that completes no hito with a plain dialog, and Cancel saves nothing", async () => {
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Finalizar 04" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Finalizar Albañilería y saneamiento" }));
    expect(dialog.queryByText(/Con esto se cumple/)).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Finalizar" })).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    expect(actions.finishChapterAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("corrects a finished chapter's dates, sending only what changed", async () => {
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Corregir fechas de 05" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Corregir fechas de Cubierta inclinada" }));
    expect(dialog.getByLabelText("Fecha real de inicio")).toHaveValue("2026-09-14");
    await userEvent.click(dialog.getByRole("button", { name: "Vaciar Fecha real de fin" }));
    await userEvent.type(dialog.getByLabelText("Motivo"), "Falta rematar la cumbrera");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar corrección" }));

    expect(actions.correctChapterAction).toHaveBeenCalledWith("p-1", "05", {
      actualEnd: null,
      note: "Falta rematar la cumbrera",
    });
  });

  it("shows why recording failed and keeps the dialog open", async () => {
    vi.mocked(actions.startChapterAction).mockResolvedValue({ error: "invalid_state" });
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Iniciar 12" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Iniciar" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("El capítulo ya no está en ese estado. Recarga la página.");
  });

  it("logs an issue on a chapter and then uploads its attachment", async () => {
    vi.mocked(actions.createIssueAction).mockResolvedValue({ success: true, issueId: "issue-new" });
    renderScreen();

    await userEvent.click(table().getByRole("button", { name: "Registrar incidencia en 06" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Registrar incidencia" }));
    expect(dialog.getByLabelText("Capítulo afectado")).toHaveValue("06");
    await userEvent.type(dialog.getByLabelText("Descripción"), "Panel dañado en la descarga");
    await userEvent.type(dialog.getByLabelText(/Impacto en coste/), "1.250,50");
    const file = new File(["%PDF"], "parte.pdf", { type: "application/pdf" });
    await userEvent.upload(dialog.getByLabelText(/Adjuntos/), file);
    await userEvent.click(dialog.getByRole("button", { name: "Guardar registro" }));

    await waitFor(() => expect(actions.addIssueFileAction).toHaveBeenCalled());
    expect(actions.createIssueAction).toHaveBeenCalledWith("p-1", {
      kind: "issue",
      occurredOn: "2026-10-17",
      chapterCode: "06",
      description: "Panel dañado en la descarga",
      party: "subcontractor",
      partyName: null,
      costImpactCents: 125_050,
      scheduleImpactDays: null,
      status: "pending",
    });
    const [projectId, issueId, , data] = vi.mocked(actions.addIssueFileAction).mock.calls[0]!;
    expect([projectId, issueId]).toEqual(["p-1", "issue-new"]);
    expect((data.get("file") as File).name).toBe("parte.pdf");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: /^(Iniciar|Finalizar|Corregir|Registrar)/ })).not.toBeInTheDocument();
  });
});
