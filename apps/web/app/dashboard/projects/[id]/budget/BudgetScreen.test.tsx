// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetApproval, BudgetRevision, ProjectBudget } from "@repo/core/contract";
import { todayInSpain } from "@repo/core/obra-calc";
import messages from "../../../../../messages/es.json";
import { budget, hitos } from "../../../../../test/obra-fixture";
import BudgetScreen from "./BudgetScreen";

vi.mock("../../../../actions/budget", () => ({
  acceptRevisionAction: vi.fn(),
  addLineAction: vi.fn(),
  addOptionAction: vi.fn(),
  askApprovalAction: vi.fn(),
  linkChangeAction: vi.fn(),
  unlinkChangeAction: vi.fn(),
  withdrawApprovalAction: vi.fn(),
  createRevisionAction: vi.fn(),
  deleteLineAction: vi.fn(),
  deleteOptionAction: vi.fn(),
  deleteRevisionAction: vi.fn(),
  issueRevisionAction: vi.fn(),
  optionFromLineAction: vi.fn(),
  rejectRevisionAction: vi.fn(),
  searchPriceBaseAction: vi.fn(),
  takeProjectDataAction: vi.fn(),
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

/** Rev.0 as the contract: accepted by the client, registered by staff a day later. */
const accepted = (changes: Partial<BudgetRevision> = {}): Budget => ({
  ...issued,
  revision: {
    ...issued.revision,
    status: "accepted",
    acceptedOn: "2026-10-21",
    acceptedBy: "D. Roberto Guzmán",
    acceptedAt: "2026-10-22T22:30:00.000Z",
    acceptedByUser: { id: "u-1", name: "Marta Ruiz" },
    signedDocumentId: "doc-9",
    ...changes,
  },
});

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

/** Holds the review saves until the returned function lets them finish. */
function holdSaves() {
  let release = () => {};
  vi.mocked(actions.updateRevisionAction).mockReturnValue(new Promise((resolve) => (release = () => resolve({ success: true }))));
  return () => act(async () => release());
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
});

/** The confirmation a button opened, by its title. */
async function confirmation(name: string) {
  return within(await screen.findByRole("alertdialog", { name }));
}

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
    expect(actions.updateRevisionAction).toHaveBeenCalledWith("p-1", "rev-1", { reviewed: { key: "annex:i1", done: true } });
  });

  it("leads with the works' price and its margins, then the chapters, the AI's checks last", async () => {
    renderScreen();

    const work = screen.getByText("Importe de la obra · sin IVA").parentElement!;
    expect(work).toHaveTextContent(/38\.554,78/);
    expect(work).toHaveTextContent(/Coste 32\.398,97/);
    expect(work).toHaveTextContent(/Margen bruto 15,97\s%\ssobre la venta/);
    expect(screen.getByText("Beneficio industrial").parentElement).toHaveTextContent(/1\.943,94/);
    expect(screen.getByText("Gastos asociados").parentElement).toHaveTextContent(/4\.211,87/);
    expect(screen.getByText("€/m² construido · sin IVA").parentElement).toHaveTextContent("184,91 m² construidos");
    // Under the chapters: the cost, then each margin in % and €.
    expect(screen.getByText(/Coste de ejecución/)).toBeInTheDocument();
    // It counts chapter 20; the Obra tab's cost doesn't, so the reserve reconciles the two.
    expect(screen.getByText(/^La Obra mide el coste sin el cap\. 20 \(1\.836,19\s€\): es la reserva de imprevistos\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Gastos asociados · 13\s%\sdel coste/)).toBeInTheDocument();
    expect(screen.getByText(/Beneficio industrial · 6\s%\sde la venta/)).toBeInTheDocument();
    const chapters = screen.getByRole("table", { name: "Resumen por capítulos" });
    expect(chapters.compareDocumentPosition(screen.getByText("1 de 2 revisados")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Typed in % on the draft.
    const profit = screen.getByLabelText("Porcentaje de beneficio industrial");
    expect(profit).toHaveValue("6");
    await userEvent.clear(profit);
    await userEvent.type(profit, "7{Enter}");
    expect(actions.updateRevisionAction).toHaveBeenCalledWith("p-1", "rev-1", { profitPct: 7 });
    const overhead = screen.getByLabelText("Porcentaje de gastos asociados");
    await userEvent.clear(overhead);
    await userEvent.type(overhead, "12,5{Enter}");
    expect(actions.updateRevisionAction).toHaveBeenCalledWith("p-1", "rev-1", { overheadPct: 12.5 });
  });

  it("warns when a draft has no margin, its lines being at cost", () => {
    renderScreen({ budget: { ...draft, revision: { ...draft.revision, profitBp: 0, profitCents: 0 } } });

    expect(screen.getByText("Beneficio industrial").parentElement).toHaveTextContent("Sin margen: las partidas están a coste");
    expect(screen.getByText("Gastos asociados").parentElement).not.toHaveTextContent("Sin margen");
  });

  it("shows the margins read-only once issued", () => {
    renderScreen({ budget: issued });

    expect(screen.queryByLabelText("Porcentaje de beneficio industrial")).not.toBeInTheDocument();
    expect(screen.getByText("Beneficio industrial").parentElement).toHaveTextContent(/6\s%\ssobre la venta/);
    expect(screen.getByText("Gastos asociados").parentElement).toHaveTextContent(/13\s%\ssobre el coste/);
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

    const release = holdSaves();
    await userEvent.click(screen.getByRole("button", { name: "Marcar revisado" }));
    expect(actions.updateRevisionAction).toHaveBeenCalledWith("p-1", "rev-1", { reviewed: { key: "annex:i1", done: true } });
    // Folded at once, while it saves.
    expect(screen.getByRole("heading", { name: "Todo revisado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver los 2 puntos" })).toHaveFocus();
    view.rerender(screenWith({ budget: reviewed() }));
    await release();
    expect(screen.getByRole("heading", { name: "Todo revisado" })).toBeInTheDocument();
  });

  it("shows quick ticks at once and saves each one on its own", async () => {
    const release = holdSaves();
    renderScreen({ budget: reviewed([false, false]) });

    const [first] = screen.getAllByRole("button", { name: "Marcar revisado" });
    await userEvent.click(first!);
    // Shown at once, before the save comes back.
    expect(screen.getByText("1 de 2 revisados")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Marcar revisado" }));

    expect(vi.mocked(actions.updateRevisionAction).mock.calls.map((call) => call[2])).toEqual([
      { reviewed: { key: "annex:i1", done: true } },
      { reviewed: { key: "line:lineage-line-2", done: true } },
    ]);
    expect(screen.getByRole("heading", { name: "Todo revisado" })).toBeInTheDocument();
    await release();
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

  it("deletes the draft after confirmation, saying it can't be undone", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Eliminar borrador" }));
    const dialog = await confirmation("¿Eliminar el borrador Rev.1?");
    expect(dialog.getByText(/no se puede deshacer\. Las revisiones anteriores no cambian\./)).toBeInTheDocument();
    expect(actions.deleteRevisionAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Eliminar borrador" }));
    expect(actions.deleteRevisionAction).toHaveBeenCalledWith("p-1", "rev-1");
  });

  it("keeps the draft when the confirmation is cancelled, and shows a failure in the dialog", async () => {
    vi.mocked(actions.deleteRevisionAction).mockResolvedValue({ error: "not_draft" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Eliminar borrador" }));
    let dialog = await confirmation("¿Eliminar el borrador Rev.1?");
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actions.deleteRevisionAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar borrador" }));
    dialog = await confirmation("¿Eliminar el borrador Rev.1?");
    await userEvent.click(dialog.getByRole("button", { name: "Eliminar borrador" }));
    expect(await dialog.findByRole("alert")).toBeInTheDocument();
  });

  it("deletes a line of the draft once confirmed, naming it", async () => {
    renderScreen({ tab: "lines", chapterCode: "05" });

    await userEvent.click(screen.getByRole("button", { name: "Más acciones de 05.91" }));
    await userEvent.click(screen.getByRole("button", { name: /Borrar partida/ }));
    const dialog = await confirmation("¿Borrar la partida 05.91?");
    expect(dialog.getByText("«Remates de chapa» se borra del borrador, y no se puede deshacer.")).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Borrar partida" }));
    expect(actions.deleteLineAction).toHaveBeenCalledWith("p-1", "line-2");
  });

  it("records the client's acceptance with the options they chose and the signed copy", async () => {
    renderScreen({ budget: issued });
    expect(screen.getByText(/Emitida el 14 oct 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar revisado" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Registrar aceptación" }));
    const dialog = await openedDialog("Registrar la aceptación de la Rev.0");
    // The day the client accepted: from the day it was issued to today, as core checks.
    const on = dialog.getByLabelText("Fecha de aceptación");
    expect(on).toHaveValue(todayInSpain());
    expect(on).toHaveAttribute("min", "2026-10-14");
    expect(on).toHaveAttribute("max", todayInSpain());
    expect(on).toHaveAccessibleDescription("Entre el día de emisión (14 oct 2026) y hoy.");
    const by = dialog.getByLabelText("Aceptado por");
    // The promoter, from the cover, by default.
    expect(by).toHaveValue("D. Roberto Guzmán Mesa");
    await userEvent.clear(by);
    await userEvent.type(by, "Roberto Guzmán");
    const pool = dialog.getByRole("button", { name: /Piscina desbordante/ });
    await userEvent.click(pool);
    expect(pool).toHaveAttribute("aria-pressed", "true");
    // The option at its price, margins in: 38.554,78 € + 45.975,00 €.
    expect(pool).toHaveTextContent(/\+45\.975,00/);
    expect(dialog.getByText(/84\.529,78/)).toBeInTheDocument();
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

  it.each([
    ["invalid_date", "Introduce una fecha válida."],
    ["not_issued", "Esa revisión no está emitida."],
  ] as const)("keeps the acceptance dialog open with core's refusal (%s)", async (error, message) => {
    vi.mocked(actions.acceptRevisionAction).mockResolvedValue({ error });
    renderScreen({ budget: issued });

    await userEvent.click(screen.getByRole("button", { name: "Registrar aceptación" }));
    const dialog = await openedDialog("Registrar la aceptación de la Rev.0");
    await userEvent.click(dialog.getByRole("button", { name: "Aceptar como contrato" }));

    expect(await dialog.findByText(message)).toBeInTheDocument();
  });

  it("shows what proves the contract: who accepted, who registered it and the signed copy", () => {
    renderScreen({ budget: accepted() });

    expect(screen.getByText("Aceptada el 21 oct 2026: es el contrato.")).toBeInTheDocument();
    expect(screen.getByText(/Aceptada por D\. Roberto Guzmán\./)).toBeInTheDocument();
    // When it was registered, in Spain: 22:30 UTC is already the 23rd there.
    expect(screen.getByText("Registrado por Marta Ruiz el 23 oct 2026, 00:30.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Copia firmada" })).toHaveAttribute("href", "/api/v1/projects/p-1/documents/doc-9");
    expect(screen.queryByText("Sin copia firmada")).not.toBeInTheDocument();
  });

  it("says so when the contract was registered without a signed copy", () => {
    renderScreen({ budget: accepted({ signedDocumentId: null }) });

    expect(screen.getByText("Registrado por Marta Ruiz el 23 oct 2026, 00:30.")).toBeInTheDocument();
    expect(screen.getByText("Sin copia firmada")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Copia firmada" })).not.toBeInTheDocument();
  });

  it("shows only the acceptance on a contract registered before the registrar was kept", () => {
    renderScreen({ budget: accepted({ acceptedByUser: null, signedDocumentId: null }) });

    expect(screen.getByText("Aceptada el 21 oct 2026: es el contrato.")).toBeInTheDocument();
    expect(screen.queryByText(/Registrado por/)).not.toBeInTheDocument();
    // Its signed copy may be among the documents, not linked: nothing is claimed.
    expect(screen.queryByText("Sin copia firmada")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Copia firmada" })).not.toBeInTheDocument();
  });

  it("rejects an issued revision or starts the next one with changes", async () => {
    renderScreen({ budget: issued });

    await userEvent.click(screen.getByRole("button", { name: "Rechazado" }));
    const dialog = await confirmation("¿Marcar la Rev.0 como rechazada por el cliente?");
    expect(dialog.getByText(/ya no se podrá aceptar/)).toBeInTheDocument();
    expect(actions.rejectRevisionAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Marcar como rechazada" }));
    expect(actions.rejectRevisionAction).toHaveBeenCalledWith("p-1", "rev-0");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // The buttons wait for that action to finish.
    const next = screen.getByRole("button", { name: "Crear Rev.1 con cambios" });
    await waitFor(() => expect(next).toBeEnabled());
    await userEvent.click(next);
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/projects/p-1/budget/options"));
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

describe("the project's client and address", () => {
  /** The project's client and address, the draft naming others. */
  const differing = (base: Budget = draft): Budget => ({
    ...base,
    revision: {
      ...base.revision,
      identity: { client: "Ana Peña Ruiz", address: "Barrio Caviedes 12, Valdáliga", differs: ["promoter", "site"], projectLacks: [] },
    },
  });

  it("shows both on the draft's texts and takes the project's on request, or links to correct the project", async () => {
    renderScreen({ budget: differing(), tab: "texts" });

    const notice = screen.getByRole("status", { name: "El presupuesto no nombra al cliente o la dirección del proyecto" });
    expect(notice).toHaveTextContent(/Promotor.*En el presupuesto.*D\. Roberto Guzmán Mesa.*En el proyecto.*Ana Peña Ruiz/);
    expect(notice).toHaveTextContent(/Emplazamiento.*C\/ de la Arboleda 3, Zarzalejo \(Madrid\).*Barrio Caviedes 12, Valdáliga/);
    expect(within(notice).getByRole("link", { name: "Corregir el proyecto" })).toHaveAttribute("href", "/dashboard/projects/p-1");

    await userEvent.click(within(notice).getByRole("button", { name: "Usar los datos del proyecto" }));
    expect(actions.takeProjectDataAction).toHaveBeenCalledWith("p-1", "rev-1");
  });

  it("only mentions what the draft names and the project lacks", () => {
    const lacking: Budget = { ...draft, revision: { ...draft.revision, identity: { client: null, address: "C/ de la Arboleda 3", differs: [], projectLacks: ["promoter"] } } };
    renderScreen({ budget: lacking, tab: "texts" });

    expect(screen.getByText(/El proyecto aún no tiene cliente; el presupuesto dice «D\. Roberto Guzmán Mesa»/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar los datos del proyecto" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a la pestaña General" })).toHaveAttribute("href", "/dashboard/projects/p-1");
  });

  it("shows viewers the notice without its actions", () => {
    renderScreen({ budget: differing(), tab: "texts", canManage: false });

    expect(screen.getByRole("status", { name: /no nombra al cliente/ })).toHaveTextContent("Ana Peña Ruiz");
    expect(screen.queryByRole("button", { name: "Usar los datos del proyecto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Corregir el proyecto" })).not.toBeInTheDocument();
  });

  it("says it in one quiet line on the summary, pointing to the texts", () => {
    renderScreen({ budget: differing() });

    expect(screen.getByText(/no coinciden con los del proyecto/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar en Textos" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget/texts");
    expect(screen.queryByRole("button", { name: "Usar los datos del proyecto" })).not.toBeInTheDocument();
  });

  it("only notes it, read-only, on a revision given to the client", () => {
    renderScreen({ budget: differing(issued), tab: "texts" });

    expect(screen.getByText(/Los datos del proyecto no coinciden con los de esta revisión: cliente «Ana Peña Ruiz» · dirección «Barrio Caviedes 12, Valdáliga»\. Ya se entregó al cliente/)).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /no nombra al cliente/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar los datos del proyecto" })).not.toBeInTheDocument();
  });

  it("says nothing when the draft names the project's data", () => {
    renderScreen({ tab: "texts" });

    expect(screen.queryByRole("status", { name: /no nombra al cliente/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no coinciden/)).not.toBeInTheDocument();
  });
});

describe("BudgetScreen: a change to the contract and the client's approval in the app", () => {
  const approval = (changes: Partial<BudgetApproval> = {}): BudgetApproval => ({
    id: "approval-1",
    status: "pending",
    message: "La piscina que hablamos",
    chosenOptionIds: ["option-1"],
    beforeCents: 3_680_883,
    afterCents: 8_452_978,
    vatRateBp: 1000,
    documentId: "doc-7",
    askedAt: "2026-11-02T09:00:00.000Z",
    askedBy: "Marta Ruiz",
    decidedAt: null,
    decidedOn: null,
    decidedBy: null,
    rejectReason: null,
    closedAt: null,
    closedBy: null,
    ...changes,
  });
  /** Rev.1 issued: it changes the contract. */
  const issuedChange = (revision: Partial<BudgetRevision> = {}): Budget => ({
    ...draft,
    revisions: [{ ...draft.revisions[0]!, status: "issued", issuedOn: "2026-11-02" }, ...draft.revisions.slice(1)],
    revision: { ...draft.revision, status: "issued", issuedOn: "2026-11-02", validUntil: "2027-01-31", changeReason: "Piscina", ...revision },
  });
  const cam4 = { id: "cam-4", number: 4, description: "Piscina en el jardín" };
  const card = () => within(screen.getByRole("region", { name: "Cambios de obra y aprobación del cliente" }));

  it("links a change and asks the client, with a message and the options proposed", async () => {
    renderScreen({ budget: issuedChange(), changes: [cam4] });

    expect(card().getByText("Todavía no se ha pedido al cliente.")).toBeInTheDocument();
    await userEvent.click(card().getByRole("button", { name: "Vincular" }));
    expect(actions.linkChangeAction).toHaveBeenCalledWith("p-1", "rev-1", "cam-4");

    // The card's buttons are off while the link is saved: a click before that ends would do nothing.
    await waitFor(() => expect(card().getByRole("button", { name: "Pedir aprobación en la app" })).toBeEnabled());
    await userEvent.click(card().getByRole("button", { name: "Pedir aprobación en la app" }));
    const dialog = await openedDialog("Pedir al cliente que apruebe la Rev.1");
    await userEvent.type(dialog.getByLabelText(/Mensaje al cliente/), "La piscina que hablamos");
    await userEvent.click(dialog.getByRole("button", { name: /Piscina desbordante/ }));
    await userEvent.click(dialog.getByRole("button", { name: "Pedir aprobación" }));

    await waitFor(() =>
      expect(actions.askApprovalAction).toHaveBeenCalledWith("p-1", "rev-1", { message: "La piscina que hablamos", chosenOptionIds: ["option-1"] }),
    );
  });

  it("shows the request waiting, holds the links as shown, and withdraws it after asking", async () => {
    const linked = [{ ...cam4, occurredOn: "2026-10-01", costImpactCents: 4_597_500 }];
    renderScreen({ budget: issuedChange({ approvals: [approval()], changes: linked }), changes: [cam4] });

    expect(card().getByText("CAM-004")).toBeInTheDocument();
    expect(card().getByText("Esperando al cliente")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "PDF que vio" })).toHaveAttribute("href", "/api/v1/projects/p-1/documents/doc-7");
    expect(card().queryByRole("button", { name: "Pedir aprobación en la app" })).not.toBeInTheDocument();
    expect(card().queryByRole("button", { name: "Quitar CAM-004" })).not.toBeInTheDocument();

    await userEvent.click(card().getByRole("button", { name: "Retirar" }));
    const confirm = await confirmation("¿Retirar la petición de aprobación de la Rev.1?");
    await userEvent.click(confirm.getByRole("button", { name: "Retirar la petición" }));
    await waitFor(() => expect(actions.withdrawApprovalAction).toHaveBeenCalledWith("p-1", "rev-1"));
  });

  it("shows a rejection with the client's reason", () => {
    const rejected = approval({ status: "rejected", decidedAt: "2026-11-03T10:00:00.000Z", decidedOn: "2026-11-03", decidedBy: "Elena Ruiz", rejectReason: "Muy cara" });
    renderScreen({ budget: issuedChange({ approvals: [rejected] }) });

    expect(card().getByText("Rechazada en la app")).toBeInTheDocument();
    expect(card().getByText("Motivo del cliente: «Muy cara»")).toBeInTheDocument();
  });

  it("starts the acceptance from the client's approval, which counts as proof with the options approved", async () => {
    const approved = approval({ status: "approved", decidedAt: "2026-11-03T10:00:00.000Z", decidedOn: "2026-11-03", decidedBy: "Elena Ruiz" });
    renderScreen({ budget: issuedChange({ approvals: [approved] }) });

    await userEvent.click(screen.getByRole("button", { name: "Registrar aceptación" }));
    const dialog = await openedDialog("Registrar la aceptación de la Rev.1");
    expect(dialog.getByLabelText("Fecha de aceptación")).toHaveValue("2026-11-03");
    const pool = dialog.getByRole("button", { name: /Piscina desbordante/ });
    expect(pool).toHaveAttribute("aria-pressed", "true");
    expect(dialog.getByText(/Elena Ruiz aprobó esta revisión en la app/)).toBeInTheDocument();
    expect(dialog.getByText("Se guarda como prueba junto a la copia firmada.")).toBeInTheDocument();

    await userEvent.click(pool);
    expect(dialog.getByText("Las opciones no son las que aprobó: su aprobación no constará como prueba.")).toBeInTheDocument();
  });

  it("without an app client, says so instead of asking", () => {
    renderScreen({ budget: issuedChange(), clientName: null });

    expect(card().getByText(/El proyecto no tiene cliente de la app/)).toBeInTheDocument();
    expect(card().queryByRole("button", { name: "Pedir aprobación en la app" })).not.toBeInTheDocument();
  });
});
