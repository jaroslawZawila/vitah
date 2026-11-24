// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import messages from "../../../../../../messages/es.json";
import { control, header } from "../../../../../../test/construction-fixture";
import { chapterOf, planningControl } from "../../../../../../test/planning-control-fixture";
import { emptyPlanning, planning, planningRows } from "../../../../../../test/planning-fixture";
import PlanningScreen from "./PlanningScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../../actions/planning", () => ({ createPlanningDraftAction: vi.fn() }));
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
const planningActions = await import("../../../../../actions/planning");
const actions = await import("../../../../../actions/construction");

/** With the approved plan (VTH-26-001 on 19 Oct 2026, baseline v2) unless told otherwise. */
function renderScreen(props: Partial<Parameters<typeof PlanningScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PlanningScreen projectId="p-1" header={header} control={planningControl} planning={planning} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

/** No plan yet: the chapters on simulated dates (VTH-26-001 on 17 Oct 2026). */
const renderWithoutPlan = (props: Partial<Parameters<typeof PlanningScreen>[0]> = {}) =>
  renderScreen({ control, planning: emptyPlanning, ...props });

/** The table (from 768px); the phone cards repeat the same buttons. */
const table = () => within(screen.getByRole("region", { name: "Capítulos y fechas" }));
const row = (name: string) => within(table().getByRole("link", { name }).closest("tr")!);
/** A phone's card: the chapter's link covers it. */
const card = (name: string) =>
  screen
    .getAllByRole("link", { name })
    .find((link) => !link.closest("table"))!
    .closest("article")!;

beforeEach(() => {
  router.push.mockReset();
  vi.mocked(planningActions.createPlanningDraftAction).mockReset().mockResolvedValue({ success: true });
  for (const action of Object.values(actions)) (action as Mock).mockReset().mockResolvedValue({ success: true });
  // The finish asks for the hito's invoice when it was the last chapter.
  vi.mocked(actions.finishChapterAction).mockResolvedValue({ success: true, invoiceRequested: "H4" });
});

describe("PlanningScreen with an approved plan", () => {
  it("shows the baseline, where the works are heading, and each chapter's plan against what happened", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Planificación" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("navigation", { name: "Secciones de obra" }));
    expect(tabs.getByRole("link", { current: "page" })).toHaveTextContent("Planificación");
    // Avance is no tab of its own any more: its chapters are here.
    expect(tabs.queryByRole("link", { name: "Avance" })).not.toBeInTheDocument();
    expect(screen.getByText("Línea base v2")).toBeInTheDocument();
    expect(screen.getByText(/motivo: «Lluvias de septiembre»/)).toBeInTheDocument();

    const kpis = within(screen.getByRole("region", { name: "Resumen del plan" }));
    expect(kpis.getByText("17 dic 2026")).toBeInTheDocument();
    expect(kpis.getByText("6 días sobre el contrato")).toBeInTheDocument();

    const finishes = row("Revestimientos interiores y falsos techos");
    expect(table().getByRole("link", { name: "Revestimientos interiores y falsos techos" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/obra/avance/03",
    );
    expect(finishes.getByText("Tras 02 · H8 · 20 días laborables · empieza el 26 oct 2026 según plan")).toBeInTheDocument();
    expect(finishes.getByText("Crítica")).toBeInTheDocument();
    expect(finishes.getByText("+7 d vs. línea base")).toBeInTheDocument();
    // The baseline's dates, and where the forecast has taken them.
    expect(finishes.getByText("Previsto", { exact: false }).closest("div")).toHaveTextContent("Previsto 2 nov 2026 – 27 nov 2026");
    expect(finishes.getByRole("img")).toHaveAccessibleName("Plan 26 oct 2026 a 20 nov 2026, previsto 2 nov 2026 a 27 nov 2026");
    // Lead times are gone: no order-by date.
    expect(screen.queryByText(/pedir antes/i)).not.toBeInTheDocument();

    const structure = row("Cimentación y estructura");
    expect(structure.getByText("70 % ejecutado")).toBeInTheDocument();
    expect(structure.getByRole("img")).toHaveAccessibleName(
      "Plan 16 mar 2026 a 23 oct 2026, real desde 17 mar 2026, previsto 20 oct 2026 a 30 oct 2026",
    );
    expect(row("Control de calidad").getByText(/^Toda la obra/)).toBeInTheDocument();
    // A finished chapter's days are figures (mono), after what it waits for.
    const first = row("Actuaciones previas y movimiento de tierras").getByText("15 d · plan 12 d");
    expect(first).toHaveClass("num");
    expect(first.parentElement).toHaveTextContent("Desde el inicio de obra · H2 · 10 días laborables · 15 d · plan 12 d");

    expect(screen.getByRole("link", { name: "Versiones" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion/versiones");
    expect(screen.getByText(/Días = días laborables \(festivos nacionales y de Asturias/)).toBeInTheDocument();
    // The bars say what they are: the baseline, what happened, what is still to come, the critical path.
    for (const label of ["Línea base", "Real", "En curso", "Previsto", "Ruta crítica"]) {
      expect(screen.getAllByText(label, { selector: "span" }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Simulado")).not.toBeInTheDocument();
  });

  it("lists the chapters in the plan's order", () => {
    const reordered = [planningRows[2]!, planningRows[0]!, planningRows[1]!, planningRows[4]!, planningRows[3]!];
    renderScreen({ planning: { ...planning, baseline: { ...planning.baseline!, rows: reordered } } });
    expect(table().getAllByRole("link").map((l) => l.textContent)).toEqual(reordered.map((r) => r.name));
    expect(screen.getAllByRole("article").map((a) => a.querySelector("a")!.textContent)).toEqual(reordered.map((r) => r.name));
  });

  it("gives phones a card per chapter: its plan, forecast, real dates, working days and what it waits for", () => {
    renderScreen();
    const pending = card("Revestimientos interiores y falsos techos");
    expect(pending).toHaveClass("relative");
    expect(within(pending).getByRole("link")).toHaveAttribute("href", "/dashboard/projects/p-1/obra/avance/03");
    expect(within(pending).getByRole("link")).toHaveClass("after:absolute", "after:inset-0");
    const value = (item: HTMLElement, term: string) => within(item).getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
    expect(within(pending).getByText("Pendiente")).toBeInTheDocument();
    expect(within(pending).getByText("Crítica")).toBeInTheDocument();
    expect(within(pending).getByText("+7 d vs. línea base")).toBeInTheDocument();
    expect(value(pending, "Plan")).toBe("26 oct 2026 – 20 nov 2026 · en 7 d");
    expect(value(pending, "Previsto")).toBe("2 nov 2026 – 27 nov 2026");
    expect(value(pending, "Duración")).toBe("20 días laborables");
    expect(value(pending, "Empieza")).toBe("Tras 02 · H8");
    expect(within(pending).queryByText("Real", { selector: "dt" })).not.toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Iniciar 03" }).closest("div.relative")).not.toBeNull();
    // With a plan, a pending chapter's card draws its bar too: where it is heading, ringed on the critical path.
    expect(within(pending).getByRole("img")).toHaveAccessibleName("Plan 26 oct 2026 a 20 nov 2026, previsto 2 nov 2026 a 27 nov 2026");

    const started = card("Cimentación y estructura");
    expect(value(started, "Real")).toBe("17 mar 2026 – … · 70\u00a0% ejecutado");
    expect(within(started).getByRole("button", { name: "Finalizar 02" })).toBeInTheDocument();
    const finished = card("Actuaciones previas y movimiento de tierras");
    expect(value(finished, "Real")).toBe("2 mar 2026 – 16 mar 2026");
    expect(within(finished).queryByText("Previsto", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("says which chapters are late to start or to finish", () => {
    const [first, second, third, ...others] = planningRows;
    const chapters = [
      chapterOf(first!),
      chapterOf(second!, { plannedEnd: "2026-10-17", overdueDays: 2 }),
      chapterOf(third!, { plannedStart: "2026-10-16" }),
      ...others.map((r) => chapterOf(r)),
    ];
    renderScreen({ control: { ...planningControl, chapters } });
    expect(within(card("Revestimientos interiores y falsos techos")).getByText("Inicio previsto superado · +3 d")).toBeInTheDocument();
    expect(within(card("Cimentación y estructura")).getByText("Fin previsto superado · +2 d")).toBeInTheDocument();
    expect(within(card("Pinturas y varios")).queryByText(/previsto superado/)).not.toBeInTheDocument();
  });

  it("filters by state and to the critical path, and hides the baseline's bars", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Solo ruta crítica" }));
    expect(table().getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Cimentación y estructura",
      "Revestimientos interiores y falsos techos",
      "Pinturas y varios",
    ]);
    // The states count what the critical path leaves.
    const states = within(screen.getByRole("group", { name: "Estado" }));
    expect(states.getByRole("button", { name: /Pendiente\S*\s*2$/ })).toBeInTheDocument();
    await userEvent.click(states.getByRole("button", { name: /Pendiente/ }));
    expect(table().getAllByRole("link").map((l) => l.textContent)).toEqual(["Revestimientos interiores y falsos techos", "Pinturas y varios"]);
    // Nothing finished is critical: the list says so rather than going blank.
    await userEvent.click(states.getByRole("button", { name: /Finalizado/ }));
    expect(screen.getByText("Ningún capítulo coincide con los filtros.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Capítulos y fechas" })).not.toBeInTheDocument();
    await userEvent.click(states.getByRole("button", { name: /Pendiente/ }));

    expect(screen.getByText("Línea base", { selector: "span" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Comparar con la línea base" }));
    expect(screen.getByRole("button", { name: "Comparar con la línea base" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Línea base", { selector: "span" })).not.toBeInTheDocument();
    expect(row("Pinturas y varios").getByRole("img")).toHaveAccessibleName("previsto 30 nov 2026 a 17 dic 2026");
  });

  it("records a chapter's start on the day given", async () => {
    renderScreen();
    await userEvent.click(table().getByRole("button", { name: "Iniciar 03" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Iniciar Revestimientos interiores y falsos techos" }));
    const date = dialog.getByLabelText("Fecha real de inicio");
    expect(date).toHaveAttribute("max", "2026-10-19");
    fireEvent.change(date, { target: { value: "2026-10-16" } });
    await userEvent.click(dialog.getByRole("button", { name: "Iniciar" }));

    expect(actions.startChapterAction).toHaveBeenCalledWith("p-1", "03", "2026-10-16");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens a draft of the baseline, or goes back to the open one", async () => {
    const { unmount } = renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Editar plan" }));
    expect(planningActions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", { from: "baseline" });
    // Once the draft exists, its editor opens.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar"));
    unmount();

    renderScreen({ planning: { ...planning, draft: { ...planning.baseline!, id: "v3", number: 3, status: "draft", approvedAt: null, approvedBy: null } } });
    expect(screen.getByRole("link", { name: "Seguir con el borrador v3" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion/editar");
    expect(screen.getByText("Borrador v3")).toBeInTheDocument();
  });

  it("shows an error from opening the draft", async () => {
    vi.mocked(planningActions.createPlanningDraftAction).mockResolvedValue({ error: "draft_exists" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Editar plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay un borrador abierto");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("lets viewers see the plan and the chapters without changing anything", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: /^(Iniciar|Finalizar|Corregir|Registrar|Editar plan)/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Versiones" })).toBeInTheDocument();
    expect(table().getAllByRole("link")).toHaveLength(planningRows.length);
  });
});

describe("PlanningScreen without a plan", () => {
  it("shows the chapters on simulated dates, with the way to record them and to a first plan", () => {
    renderWithoutPlan();
    expect(screen.getByText("Esta obra aún no tiene plan.")).toBeInTheDocument();
    expect(screen.getAllByText("Simulado").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Solo ruta crítica" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Versiones" })).not.toBeInTheDocument();

    const filter = within(screen.getByRole("group", { name: "Estado" }));
    expect(filter.getByRole("button", { name: /En curso\s*2/ })).toHaveAttribute("aria-pressed", "false");
    // The budget's order.
    expect(table().getAllByRole("link").map((l) => l.textContent)).toEqual(control.chapters.map((c) => c.name));
    const envelope = row("Envolvente térmica Thermochip");
    expect(envelope.getByText("Fin previsto superado · +8 d")).toBeInTheDocument();
    expect(envelope.getByText("1 incidencia")).toBeInTheDocument();
    expect(envelope.getByRole("img", { name: "Plan 14 sept 2026 a 9 oct 2026, real desde 21 sept 2026" })).toBeInTheDocument();
    const done = row("Carpintería exterior e interior");
    expect(done.getByText("23 d · plan 19 d")).toBeInTheDocument();
    expect(table().getByText("empieza el 19 oct 2026 según plan")).toBeInTheDocument();
    expect(screen.queryByText(/ejecutado/)).not.toBeInTheDocument();

    // "· en 2 d" is its own piece on a phone's card, free to go to the next line.
    const soon = within(card("Electricidad e iluminación")).getByText("· en 2 d");
    expect(soon.closest(".num")).toBeNull();
    expect(soon.parentElement).toHaveTextContent("19 oct 2026 – 27 nov 2026 · en 2 d");
    // Without a plan a pending chapter's card has no bar: only its simulated dates.
    expect(within(card("Electricidad e iluminación")).queryByRole("img")).not.toBeInTheDocument();
  });

  it("generates a first plan from the template, with a preview", async () => {
    renderWithoutPlan();
    expect(screen.queryByLabelText("Inicio de obra (acta de inicio)")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Generar el plan" }));
    expect(screen.getByRole("button", { name: "Generar el plan" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Inicio de obra (acta de inicio)")).toHaveValue("2026-03-02");
    expect(screen.getByText("Fin del borrador")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Festivos autonómicos"), "as");
    await userEvent.click(screen.getByLabelText("Navidad: del 24/12 al 6/1"));
    await userEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(planningActions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", {
      from: "template",
      startDate: "2026-03-02",
      region: "as",
      augustClosure: true,
      christmasClosure: false,
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar"));
  });

  it("can copy another project's plan", async () => {
    renderWithoutPlan();
    await userEvent.click(screen.getByRole("button", { name: "Generar el plan" }));
    await userEvent.click(screen.getByRole("radio", { name: /Copiar de otra obra/ }));
    expect(screen.getByLabelText("Obra")).toHaveValue("p-2");
    await userEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(planningActions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", expect.objectContaining({ from: "project", projectId: "p-2" }));
  });

  it("shows an open draft above the chapters", () => {
    renderWithoutPlan({ planning: { ...emptyPlanning, draft: { ...planning.baseline!, id: "v1", number: 1, status: "draft", approvedAt: null, approvedBy: null } } });
    expect(screen.getByText("Borrador v1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Seguir editando" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion/editar");
    expect(screen.queryByRole("button", { name: "Generar el plan" })).not.toBeInTheDocument();
    expect(table().getAllByRole("link")).toHaveLength(control.chapters.length);
  });

  it("finishing the last chapter of a hito shows the invoice it will request", async () => {
    renderWithoutPlan();
    await userEvent.click(table().getByRole("button", { name: "Finalizar 06" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Finalizar Envolvente térmica Thermochip" }));
    expect(dialog.getByText("Con esto se cumple el hito H4 · Envolvente estanca")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Finalizar y pedir factura" }));

    expect(actions.finishChapterAction).toHaveBeenCalledWith("p-1", "06", "2026-10-17");
    const done = within(await screen.findByRole("status"));
    expect(done.getByText("Capítulo 06 finalizado")).toBeInTheDocument();
    expect(done.getByText("Factura solicitada")).toBeInTheDocument();
    // Already on Planificación: no way "back" to it.
    expect(done.queryByRole("link", { name: "Volver a Planificación" })).not.toBeInTheDocument();
  });

  it("says what the server did: no request when someone else's finish already made it", async () => {
    vi.mocked(actions.finishChapterAction).mockResolvedValue({ success: true, invoiceRequested: null });
    renderWithoutPlan();
    await userEvent.click(table().getByRole("button", { name: "Finalizar 06" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Finalizar Envolvente térmica Thermochip" }));
    await userEvent.click(dialog.getByRole("button", { name: "Finalizar y pedir factura" }));
    const done = within(await screen.findByRole("status"));
    expect(done.getByText("Capítulo 06 finalizado")).toBeInTheDocument();
    expect(done.queryByText("Factura solicitada")).not.toBeInTheDocument();
  });

  it("corrects a finished chapter's dates, sending only what changed", async () => {
    renderWithoutPlan();
    await userEvent.click(table().getByRole("button", { name: "Corregir fechas de 05" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Corregir fechas de Cubierta inclinada" }));
    expect(dialog.getByLabelText("Fecha real de inicio")).toHaveValue("2026-09-14");
    await userEvent.click(dialog.getByRole("button", { name: "Vaciar Fecha real de fin" }));
    await userEvent.type(dialog.getByLabelText("Motivo"), "Falta rematar la cumbrera");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar corrección" }));
    expect(actions.correctChapterAction).toHaveBeenCalledWith("p-1", "05", { actualEnd: null, note: "Falta rematar la cumbrera" });
  });

  it("shows why recording failed and keeps the dialog open", async () => {
    vi.mocked(actions.startChapterAction).mockResolvedValue({ error: "invalid_state" });
    renderWithoutPlan();
    await userEvent.click(table().getByRole("button", { name: "Iniciar 12" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Iniciar" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("El capítulo ya no está en ese estado. Recarga la página.");
  });

  it("logs an issue on a chapter and then uploads its attachment", async () => {
    vi.mocked(actions.createIssueAction).mockResolvedValue({ success: true, issueId: "issue-new" });
    renderWithoutPlan();
    await userEvent.click(table().getByRole("button", { name: "Registrar incidencia en 06" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Registrar incidencia" }));
    expect(dialog.getByLabelText("Capítulo afectado")).toHaveValue("06");
    await userEvent.type(dialog.getByLabelText("Descripción"), "Panel dañado en la descarga");
    const file = new File(["%PDF"], "parte.pdf", { type: "application/pdf" });
    await userEvent.upload(dialog.getByLabelText(/Adjuntos/), file);
    await userEvent.click(dialog.getByRole("button", { name: "Guardar registro" }));

    await waitFor(() => expect(actions.addIssueFileAction).toHaveBeenCalled());
    expect(actions.createIssueAction).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ kind: "issue", chapterCode: "06", description: "Panel dañado en la descarga" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("only tells viewers there is no plan, and leaves them nothing to change", () => {
    renderWithoutPlan({ canManage: false });
    expect(screen.getByText("Un administrador o gestor puede generar el plan.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Generar|Crear borrador|Iniciar|Finalizar|Corregir|Registrar)/ })).not.toBeInTheDocument();
    expect(table().getAllByRole("link")).toHaveLength(control.chapters.length);
  });

  it("says when there is no accepted budget to plan", () => {
    renderWithoutPlan({ control: { ...control, chapters: [] }, planning: { ...emptyPlanning, chapters: [] } });
    expect(screen.getByText("Para planificar la obra hace falta un presupuesto aceptado.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Capítulos y fechas" })).not.toBeInTheDocument();
  });
});
