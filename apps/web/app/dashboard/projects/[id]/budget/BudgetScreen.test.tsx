// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetRevision, ProjectBudget } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import { budget, hitos } from "../../../../../test/obra-fixture";
import BudgetScreen from "./BudgetScreen";

vi.mock("../../../../actions/budget", () => ({
  acceptRevisionAction: vi.fn(),
  addLineAction: vi.fn(),
  addOptionAction: vi.fn(),
  createRevisionAction: vi.fn(),
  deleteLineAction: vi.fn(),
  deleteOptionAction: vi.fn(),
  deleteRevisionAction: vi.fn(),
  issueRevisionAction: vi.fn(),
  optionFromLineAction: vi.fn(),
  rejectRevisionAction: vi.fn(),
  searchPriceBaseAction: vi.fn(),
  updateChapterAction: vi.fn(),
  updateLineAction: vi.fn(),
  updateOptionAction: vi.fn(),
  updateRevisionAction: vi.fn(),
}));
vi.mock("../../../../actions/obra", () => ({ savePlanAction: vi.fn() }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const actions = await import("../../../../actions/budget");

type Budget = ProjectBudget & { revision: BudgetRevision };
const draft = budget as Budget;
const issued: Budget = {
  ...budget,
  revisions: budget.revisions.slice(1),
  revision: { ...draft.revision, id: "rev-0", number: 0, status: "issued", issuedOn: "2026-10-14", validUntil: "2027-01-12", changeReason: null, previous: null },
};

function renderScreen(props: Partial<Parameters<typeof BudgetScreen>[0]> = {}) {
  return render(screenWith(props));
}

function screenWith(props: Partial<Parameters<typeof BudgetScreen>[0]> = {}) {
  return (
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <BudgetScreen
        projectId="p-1"
        projectRef="VTH-26-001"
        site="Zarzalejo"
        clientName="Roberto Guzmán"
        budget={draft}
        canManage
        tab="summary"
        inputs={[]}
        hitos={hitos}
        {...props}
      />
    </NextIntlClientProvider>
  );
}

/** The draft with its AI checks ticked (all of them by default). */
const reviewed = (done = [true, true]): Budget => ({
  ...draft,
  revision: { ...draft.revision, checks: draft.revision.checks.map((c, i) => ({ ...c, done: done[i] ?? true })) },
});

/**
 * The open dialog, once it has moved focus into itself. It does so a moment
 * after opening; typing before that sends the keys to its close button.
 */
async function openedDialog(name: string | RegExp) {
  const popup = await screen.findByRole("dialog", { name });
  await waitFor(() => expect(popup).toContainElement(document.activeElement as HTMLElement));
  return within(popup);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(actions)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  vi.mocked(actions.searchPriceBaseAction).mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("BudgetScreen", () => {
  it("summarises a draft: the AI's checks, figures, chapters and options", async () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Presupuesto" })).toBeInTheDocument();
    expect(screen.getByText("1 de 2 revisados")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PDF general" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/pdf?kind=general");
    const chapters = screen.getByRole("table", { name: "Resumen por capítulos" });
    expect(within(chapters).getByRole("link", { name: /Actuaciones previas/ })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/lines?chapter=01");
    expect(screen.getByText("Piscina desbordante")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Marcar revisado" }));
    expect(actions.updateRevisionAction).toHaveBeenCalledWith("p-1", "rev-1", { review: { done: ["line:lineage-line-2", "annex:i1"] } });
  });

  it("folds the AI checks into one row once all are reviewed, and opens them again", async () => {
    renderScreen({ budget: reviewed() });

    expect(screen.getByRole("heading", { name: "Todo revisado" })).toBeInTheDocument();
    expect(screen.getByText("Los 2 puntos están revisados.")).toBeInTheDocument();
    expect(screen.queryByText("Carga de nieve")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ver los 2 puntos" }));
    expect(screen.getByText("Carga de nieve")).toBeInTheDocument();
    expect(screen.getByText("2 de 2 revisados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(screen.queryByText("Carga de nieve")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver los 2 puntos" })).toHaveFocus();
  });

  it("folds the checks again when the last open one is ticked", async () => {
    const view = renderScreen({ budget: reviewed() });
    await userEvent.click(screen.getByRole("button", { name: "Ver los 2 puntos" }));

    // Untick one: the list stays open with it.
    view.rerender(screenWith({ budget: reviewed([false, true]) }));
    expect(screen.getByText("1 de 2 revisados")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Marcar revisado" }));
    expect(actions.updateRevisionAction).toHaveBeenCalledWith("p-1", "rev-1", { review: { done: ["line:lineage-line-2", "annex:i1"] } });
    view.rerender(screenWith({ budget: reviewed() }));
    expect(screen.getByRole("heading", { name: "Todo revisado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver los 2 puntos" })).toHaveFocus();
  });

  it("folds the checks when the last open one goes away", async () => {
    const view = renderScreen({ budget: reviewed() });
    await userEvent.click(screen.getByRole("button", { name: "Ver los 2 puntos" }));
    view.rerender(screenWith({ budget: reviewed([false, true]) }));

    // The open annex item is deleted on the Texts tab.
    const [, line] = reviewed().revision.checks;
    view.rerender(screenWith({ budget: { ...draft, revision: { ...draft.revision, checks: [line!] } } }));
    expect(screen.getByRole("heading", { name: "Todo revisado" })).toBeInTheDocument();
  });

  it("shows a slim row with nothing to open when the AI flagged nothing", () => {
    renderScreen({ budget: { ...draft, revision: { ...draft.revision, checks: [] } } });

    expect(screen.getByRole("heading", { name: "Nada pendiente" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ver / })).not.toBeInTheDocument();
  });

  it("issues the draft with its dates and the client sharing choice", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Emitir Rev.1" }));
    const dialog = await openedDialog("Emitir la Rev.1 al cliente");
    expect(dialog.getByText(/Roberto Guzmán lo verá en Documentos/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("checkbox"));
    await userEvent.click(dialog.getByRole("button", { name: "Emitir Rev.1" }));

    await waitFor(() => expect(actions.issueRevisionAction).toHaveBeenCalled());
    expect(vi.mocked(actions.issueRevisionAction).mock.calls[0]).toEqual([
      "p-1",
      "rev-1",
      expect.objectContaining({ changeReason: "Mediciones del BC3", shareWithClient: false, issuedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the issue dialog open with the error", async () => {
    vi.mocked(actions.issueRevisionAction).mockResolvedValue({ error: "change_reason_required" });
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Emitir Rev.1" }));
    const dialog = await openedDialog("Emitir la Rev.1 al cliente");
    await userEvent.click(dialog.getByRole("button", { name: "Emitir Rev.1" }));

    expect(await dialog.findByText("Escribe el motivo de la revisión antes de emitirla.")).toBeInTheDocument();
  });

  it("deletes the draft after confirmation", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Eliminar borrador" }));
    expect(actions.deleteRevisionAction).toHaveBeenCalledWith("p-1", "rev-1");
  });

  it("records the client's acceptance with the options they chose and the signed copy", async () => {
    renderScreen({ budget: issued });
    expect(screen.getByText(/Emitida el 14 oct 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar revisado" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Registrar aceptación" }));
    const dialog = await openedDialog("Registrar la aceptación de la Rev.0");
    const by = dialog.getByLabelText("Aceptado por");
    // The promoter, from the cover, by default.
    expect(by).toHaveValue("D. Roberto Guzmán Mesa");
    await userEvent.clear(by);
    await userEvent.type(by, "Roberto Guzmán");
    const pool = dialog.getByRole("button", { name: /Piscina desbordante/ });
    await userEvent.click(pool);
    expect(pool).toHaveAttribute("aria-pressed", "true");
    await userEvent.upload(dialog.getByLabelText(/Presupuesto firmado/), new File(["%PDF-"], "firmado.pdf", { type: "application/pdf" }));
    await userEvent.click(dialog.getByRole("button", { name: "Aceptar como contrato" }));

    // One action: the acceptance and its signed copy, which core files.
    await waitFor(() => expect(actions.acceptRevisionAction).toHaveBeenCalled());
    const [projectId, revisionId, form] = vi.mocked(actions.acceptRevisionAction).mock.calls[0]!;
    expect([projectId, revisionId]).toEqual(["p-1", "rev-0"]);
    expect(form.get("acceptedBy")).toBe("Roberto Guzmán");
    expect(form.getAll("chosenOptionIds")).toEqual(["option-1"]);
    expect((form.get("signed") as File).name).toBe("firmado.pdf");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rejects an issued revision or starts the next one with changes", async () => {
    renderScreen({ budget: issued });

    await userEvent.click(screen.getByRole("button", { name: "Rechazado" }));
    expect(actions.rejectRevisionAction).toHaveBeenCalledWith("p-1", "rev-0");
    await userEvent.click(screen.getByRole("button", { name: "Crear Rev.1 con cambios" }));
    expect(actions.createRevisionAction).toHaveBeenCalledWith("p-1");
  });

  it("edits a chapter's lines in place and offers one as a deduction", async () => {
    renderScreen({ tab: "lines", chapterCode: "05" });

    const quantity = screen.getByLabelText("Cantidad de 05.91");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "2,5{Enter}");
    await waitFor(() => expect(actions.updateLineAction).toHaveBeenCalledWith("p-1", "line-2", { quantity: 2.5 }));

    await userEvent.click(screen.getByRole("button", { name: "Más acciones de 05.91" }));
    await userEvent.click(screen.getByRole("button", { name: /Ofrecer como deducción/ }));
    await waitFor(() => expect(actions.optionFromLineAction).toHaveBeenCalledWith("p-1", "line-2", { kind: "deduction" }));
    expect(push).toHaveBeenCalledWith("/dashboard/projects/p-1/budget/options");
  });

  it("adds a line from outside the price base, marked estimated", async () => {
    renderScreen({ tab: "lines", chapterCode: "05" });

    await userEvent.click(screen.getByRole("button", { name: "+ Añadir partida" }));
    await waitFor(() => expect(actions.searchPriceBaseAction).toHaveBeenCalledWith("", "05"));
    await userEvent.click(screen.getByRole("button", { name: "Partida nueva fuera de la base" }));
    const dialog = await openedDialog("Partida nueva fuera de la base");
    // Core gives it the chapter's next free code.
    expect(dialog.queryByLabelText("Código")).not.toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText("Descripción de la unidad de obra"), "Vierteaguas");
    await userEvent.type(dialog.getByLabelText("Precio unitario (€)"), "48,50");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actions.addLineAction).toHaveBeenCalled());
    expect(vi.mocked(actions.addLineAction).mock.calls[0]).toEqual([
      "p-1",
      "chapter-05",
      expect.objectContaining({ source: "estimated", description: "Vierteaguas", unit: "ud", quantity: 1, unitPriceCents: 4_850 }),
    ]);
  });

  it("explains that chapter 20 is computed", () => {
    renderScreen({ tab: "lines", chapterCode: "20" });
    expect(screen.getByText(/El capítulo 20 es el 5\s?% de los capítulos 01–19/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Cantidad de 20.01")).not.toBeInTheDocument();
  });

  it("renames an option when the field loses focus", async () => {
    renderScreen({ tab: "options" });

    const option = screen.getByRole("region", { name: "Piscina desbordante" });
    const name = within(option).getByLabelText("Nombre de la opción");
    await userEvent.clear(name);
    await userEvent.type(name, "Piscina");
    await userEvent.tab();

    await waitFor(() => expect(actions.updateOptionAction).toHaveBeenCalledWith("p-1", "option-1", { name: "Piscina" }));
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false, tab: "lines", chapterCode: "05" });

    expect(screen.queryByRole("button", { name: /Emitir/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cantidad de 05.91")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Más acciones de 05.91" })).not.toBeInTheDocument();
  });

  it("switches revision from the pill beside the title, staying on the same tab", async () => {
    renderScreen({ tab: "options" });

    const tabs = screen.getByRole("navigation", { name: "Secciones del presupuesto" });
    expect(within(tabs).queryByRole("link", { name: /Revisiones/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Revisiones" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Rev.1 · Borrador" }));
    const menu = within(screen.getByRole("dialog", { name: "Revisiones" }));
    const [newest, older] = menu.getAllByRole("listitem");
    expect(newest).toHaveTextContent(/Rev\.1 · Borrador.*En borrador/);
    expect(within(newest!).getByRole("link")).toHaveAttribute("aria-current", "page");
    expect(within(newest!).getByRole("link")).toHaveAttribute("href", "/dashboard/projects/p-1/budget/options");
    expect(older).toHaveTextContent(/Rev\.0 · Emitida.*Emitida el 14 oct 2026/);
    expect(within(older!).getByRole("link")).toHaveAttribute("href", "/dashboard/projects/p-1/budget/options?revision=rev-0");
    expect(menu.getAllByRole("link")).toHaveLength(2);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Revisiones" })).not.toBeInTheDocument();
  });

  it("marks an older revision read-only and points back to the newest", async () => {
    renderScreen({ budget: { ...issued, revisions: budget.revisions }, tab: "lines", chapterCode: "05" });

    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver la última (Rev.1)" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/lines?chapter=05");
    expect(screen.queryByRole("button", { name: "Registrar aceptación" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Rev.0 · Emitida" }));
    const menu = within(screen.getByRole("dialog", { name: "Revisiones" }));
    expect(menu.getByRole("link", { name: /Rev\.1/ })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/lines?chapter=05");
    expect(menu.getByRole("link", { name: /Rev\.0/ })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/lines?revision=rev-0&chapter=05");
  });

  it("shows no read-only note on the newest revision", () => {
    renderScreen();

    expect(screen.queryByText(/Solo lectura/)).not.toBeInTheDocument();
  });
});
