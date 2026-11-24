// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { DndContextProps, DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/es.json";
import { planningDraft } from "../../../../../../../test/planning-fixture";
import EditPlanScreen from "./EditPlanScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));
vi.mock("../../../../../../actions/planning", () => ({
  approvePlanningDraftAction: vi.fn(),
  discardPlanningDraftAction: vi.fn(),
  updatePlanningDraftAction: vi.fn(),
}));
const actions = await import("../../../../../../actions/planning");
// jsdom lays nothing out, so a drag can't be acted: the real context runs, and
// the test drops a chapter through what the table gave it.
const dnd: { props?: DndContextProps } = {};
vi.mock("@dnd-kit/core", async (original) => {
  const real = await original<typeof import("@dnd-kit/core")>();
  const DndContext = (props: DndContextProps) => {
    dnd.props = props;
    return <real.DndContext {...props} />;
  };
  return { ...real, DndContext };
});

function renderScreen(props: Partial<Parameters<typeof EditPlanScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <EditPlanScreen projectId="p-1" draft={planningDraft} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  router.push.mockReset();
  vi.mocked(actions.approvePlanningDraftAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.discardPlanningDraftAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.updatePlanningDraftAction).mockReset().mockResolvedValue({ success: true });
});

afterEach(() => vi.restoreAllMocks());

const row = (name: RegExp) => within(screen.getByRole("row", { name }));
/** The chapters that don't span the works, in the list's order. */
const order = () => screen.getAllByRole("row").flatMap((r) => within(r).queryAllByRole("cell")[0]?.textContent?.match(/^\d\d$/) ?? []);
const PLAN = "/dashboard/projects/p-1/obra/planificacion";

describe("EditPlanScreen", () => {
  it("shows the chapters in order, each one's lag and length and the dates they give", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Editar el plan" })).toBeInTheDocument();
    expect(screen.getByText("Borrador v3 · sin aprobar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Volver" })).toHaveAttribute("href", PLAN);
    // No start rule, order-by date or comparison with the baseline: the order is the sequence.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Cap.",
      "Capítulo",
      "Desfase (días naturales)",
      "Duración (días laborables)",
      "Inicio – fin",
    ]);

    // Finished and started chapters keep what was recorded.
    expect(row(/Actuaciones previas/).getByText("Terminado · fechas reales registradas")).toBeInTheDocument();
    expect(row(/Actuaciones previas/).getByLabelText("Días laborables del capítulo 01")).toBeDisabled();
    expect(row(/Cimentación/).getByLabelText(/Desfase en días naturales del capítulo 02 tras el 01/)).toBeDisabled();
    expect(row(/Cimentación/).getByLabelText("Días laborables del capítulo 02")).toBeEnabled();

    // The first starts with the works; each other after the one above it.
    expect(row(/Actuaciones previas/).getByText("Con la obra")).toBeInTheDocument();
    expect(row(/Pinturas/).getByLabelText("Desfase en días naturales del capítulo 04 tras el 03 (negativo para solapar)")).toHaveValue(0);
    expect(screen.getByText(/Durante toda la obra, hasta el .*: 17 Control de calidad/)).toBeInTheDocument();
  });

  it("puts the calendar in one row above the chapters, and the check and approval below them", () => {
    renderScreen();
    const calendar = screen.getByRole("region", { name: "Calendario" });
    const table = screen.getByRole("region", { name: "Capítulos del borrador" });
    const check = screen.getByRole("region", { name: "Este borrador" });
    expect(calendar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(calendar).getByLabelText("Inicio de obra")).toHaveValue("2026-03-02");
    expect(within(calendar).getByLabelText("Festivos autonómicos")).toHaveValue("as");
    expect(within(calendar).getAllByRole("checkbox")).toHaveLength(2);
    // Nothing beside the table: it takes the page's whole width.
    expect(table.closest("aside")).toBeNull();
  });

  it("compares the draft's end with the contract in days, with no money on a delay", () => {
    const check = () => within(screen.getByRole("region", { name: "Este borrador" }));
    const { unmount } = renderScreen({ draft: { ...planningDraft, completionDate: "2027-06-30" } });
    expect(check().getByText("Termina dentro del plazo del contrato.")).toBeInTheDocument();
    expect(check().getByText("En plazo")).toBeInTheDocument();
    unmount();

    renderScreen({ draft: { ...planningDraft, completionDate: "2026-06-30" } });
    expect(check().getByText("Termina después del plazo del contrato.")).toBeInTheDocument();
    expect(check().getByText(/^\+\d+ días$/)).toBeInTheDocument();
    expect(check().queryByText(/€|enaliz/)).not.toBeInTheDocument();
    expect(check().getAllByRole("term").map((term) => term.textContent)).toEqual(["Fin previsto", "Contrato", "Retraso"]);
  });

  it("stacks each chapter's fields in a card on a phone, each beside its heading", () => {
    renderScreen();
    const painting = screen.getByRole("row", { name: /Pinturas/ });
    // A grid card below 768px, a table row from it: the same inputs serve both.
    expect(painting).toHaveClass("max-md:grid");
    const labels = [...painting.querySelectorAll("span.md\\:hidden")].map((span) => span.textContent);
    expect(labels).toEqual(["Desfase (días naturales)", "Duración (días laborables)", "Inicio – fin"]);
    const days = within(painting).getByLabelText("Días laborables del capítulo 04");
    expect(days.closest("td")).toHaveClass("max-md:col-span-2", "max-md:flex");
    expect(screen.getAllByLabelText("Días laborables del capítulo 04")).toHaveLength(1);
  });

  it("recomputes the dates as staff type, then approves with the reason", async () => {
    renderScreen();
    const painting = () => row(/Pinturas/);
    const before = painting().getAllByRole("cell")[4]!.textContent;
    await userEvent.clear(painting().getByLabelText("Días laborables del capítulo 04"));
    await userEvent.type(painting().getByLabelText("Días laborables del capítulo 04"), "20");
    expect(painting().getAllByRole("cell")[4]!.textContent).not.toBe(before);

    const approve = screen.getByRole("button", { name: "Aprobar como línea base v3" });
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Motivo del cambio"), "Retraso de la bomba de calor");
    await userEvent.click(approve);
    expect(actions.approvePlanningDraftAction).toHaveBeenCalledWith(
      "p-1",
      {
        items: expect.arrayContaining([{ code: "04", lagDays: 0, durationDays: 20 }]),
        startDate: "2026-03-02",
        region: "as",
        augustClosure: true,
        christmasClosure: true,
      },
      "Retraso de la bomba de calor",
    );
    // Once approved, back to the plan.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(PLAN));
  });

  it("moves a chapter's start by its lag in calendar days, overlapping with a negative one", async () => {
    renderScreen();
    const lag = () => row(/Pinturas/).getByLabelText(/Desfase en días naturales del capítulo 04/);
    const dates = () => row(/Pinturas/).getAllByRole("cell")[4]!.textContent;
    const before = dates();
    // Left empty, the field goes back to the lag it had.
    await userEvent.clear(lag());
    await userEvent.tab();
    expect(lag()).toHaveValue(0);
    expect(dates()).toBe(before);
    await userEvent.clear(lag());
    await userEvent.type(lag(), "-7");
    expect(dates()).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(actions.updatePlanningDraftAction).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ items: expect.arrayContaining([{ code: "04", lagDays: -7, durationDays: 13 }]) }),
    );
    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
  });

  it("moves a chapter up and down the list, its dates with it, and saves the new order", async () => {
    renderScreen();
    const arrow = (name: string) => screen.getByRole("button", { name });
    const dates = () => row(/Pinturas/).getAllByRole("cell")[4]!.textContent;
    const last = dates();
    expect(order()).toEqual(["01", "02", "03", "04"]);
    // The ends of the list go no further; 17 spans the works and has no arrows.
    expect(arrow("Subir el capítulo 01")).toBeDisabled();
    expect(arrow("Bajar el capítulo 04")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Subir el capítulo 17" })).not.toBeInTheDocument();
    // The arrows sit beside the chapter's name: at the card's top right on a phone.
    expect(arrow("Subir el capítulo 04").closest("td")).toBe(row(/Pinturas/).getAllByRole("cell")[1]);

    await userEvent.click(arrow("Subir el capítulo 04"));
    expect(order()).toEqual(["01", "02", "04", "03"]);
    // The arrow keeps the focus, to press it again; the chapter now follows 02, and starts earlier.
    expect(arrow("Subir el capítulo 04")).toHaveFocus();
    expect(row(/Pinturas/).getByLabelText(/del capítulo 04 tras el 02/)).toHaveValue(0);
    expect(row(/Revestimientos/).getByLabelText(/del capítulo 03 tras el 04/)).toBeInTheDocument();
    expect(dates()).not.toBe(last);

    await userEvent.click(arrow("Subir el capítulo 04"));
    await userEvent.click(arrow("Subir el capítulo 04"));
    // First now: its "up" is disabled, so its pair takes the focus; it starts with the works.
    expect(arrow("Subir el capítulo 04")).toBeDisabled();
    expect(arrow("Bajar el capítulo 04")).toHaveFocus();
    expect(row(/Pinturas/).getByText("Con la obra")).toBeInTheDocument();
    expect(row(/Actuaciones previas/).getByLabelText(/del capítulo 01 tras el 04/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    const sent = vi.mocked(actions.updatePlanningDraftAction).mock.calls[0]![1] as { items: { code: string }[] };
    expect(sent.items.map((i) => i.code)).toEqual(["04", "01", "02", "03", "17"]);
    expect(sent.items[0]).toEqual({ code: "04", lagDays: 0, durationDays: 13 });
  });

  it("drags a chapter any number of places by its handle, telling a screen reader where it is", async () => {
    renderScreen();
    const drop = (active: string, over: string | null) =>
      act(() => dnd.props!.onDragEnd!({ active: { id: active }, over: over && { id: over } } as DragEndEvent));
    // A handle per chapter, beside its arrows; a table row only (a phone's cards move by their arrows).
    const handle = screen.getByRole("button", { name: "Arrastrar el capítulo 04 para moverlo" });
    expect(handle).toHaveAttribute("aria-roledescription", "ordenable");
    expect(handle).toHaveClass("max-md:hidden", "touch-none");
    expect(handle.closest("td")).toBe(row(/Pinturas/).getAllByRole("cell")[1]);
    expect(screen.queryByRole("button", { name: "Arrastrar el capítulo 17 para moverlo" })).not.toBeInTheDocument();

    // Dropped on the first chapter: it takes its place, the ones between move down.
    drop("04", "01");
    expect(order()).toEqual(["04", "01", "02", "03"]);
    expect(row(/Pinturas/).getByText("Con la obra")).toBeInTheDocument();
    // Dropped on itself or outside the list: nothing moves.
    drop("04", "04");
    drop("04", null);
    expect(order()).toEqual(["04", "01", "02", "03"]);

    const { announcements, screenReaderInstructions } = dnd.props!.accessibility!;
    expect(screenReaderInstructions!.draggable).toMatch(/^Pulsa Espacio para coger el capítulo/);
    const event = { active: { id: "04" }, over: { id: "02" } } as DragOverEvent;
    expect(announcements!.onDragOver(event)).toBe("Capítulo 04 en el puesto 3 de 4.");
    expect(announcements!.onDragEnd({ ...event, over: null })).toBe("Movimiento cancelado: el capítulo 04 vuelve a su puesto.");

    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    const sent = vi.mocked(actions.updatePlanningDraftAction).mock.calls[0]![1] as { items: { code: string }[] };
    expect(sent.items.map((i) => i.code)).toEqual(["04", "01", "02", "03", "17"]);
  });

  it("drops the lag of a chapter moved to the top, as core does, so what is checked is what is sent", async () => {
    renderScreen();
    const lag = () => row(/Pinturas/).getByLabelText(/Desfase en días naturales del capítulo 04/);
    await userEvent.clear(lag());
    await userEvent.type(lag(), "999");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => dnd.props!.onDragEnd!({ active: { id: "04" }, over: { id: "01" } } as DragEndEvent));
    expect(row(/Pinturas/).getByText("Con la obra")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Back below 01 it waits for it again, with no lag.
    act(() => dnd.props!.onDragEnd!({ active: { id: "04" }, over: { id: "01" } } as DragEndEvent));
    expect(lag()).toHaveValue(0);
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    const sent = vi.mocked(actions.updatePlanningDraftAction).mock.calls[0]![1] as { items: { code: string; lagDays: number }[] };
    expect(sent.items.find((i) => i.code === "04")).toMatchObject({ lagDays: 0 });
  });

  it("refuses a lag out of range until it is put right", async () => {
    renderScreen();
    const lag = row(/Pinturas/).getByLabelText(/Desfase en días naturales del capítulo 04/);
    await userEvent.clear(lag);
    await userEvent.type(lag, "300");
    expect(screen.getByRole("alert")).toHaveTextContent("el desfase va de −250 a 250 días naturales");
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
    await userEvent.clear(lag);
    await userEvent.type(lag, "30");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeEnabled();
  });

  it("changes the calendar and discards the draft once confirmed", async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText("Festivos autonómicos"), "md");
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(actions.updatePlanningDraftAction).toHaveBeenCalledWith("p-1", expect.objectContaining({ region: "md" }));
    // The buttons are disabled until the draft is saved.
    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
    const discard = screen.getByRole("button", { name: "Descartar borrador" });
    await waitFor(() => expect(discard).toBeEnabled());

    await userEvent.click(discard);
    const dialog = within(await screen.findByRole("alertdialog", { name: "¿Descartar el borrador v3?" }));
    // A draft is deleted for real: it says so.
    expect(dialog.getByText(/no se puede deshacer/)).toBeInTheDocument();
    expect(actions.discardPlanningDraftAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Descartar borrador" }));
    expect(actions.discardPlanningDraftAction).toHaveBeenCalledWith("p-1");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(PLAN));
  });

  it("shows core's error and stays", async () => {
    vi.mocked(actions.approvePlanningDraftAction).mockResolvedValue({ error: "change_reason_required" });
    renderScreen();
    await userEvent.type(screen.getByLabelText("Motivo del cambio"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Aprobar como línea base v3" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe el motivo del cambio.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("lets viewers only look", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: "Aprobar como línea base v3" })).not.toBeInTheDocument();
    expect(row(/Pinturas/).getByLabelText("Días laborables del capítulo 04")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^(Subir|Bajar|Arrastrar) el capítulo/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Festivos autonómicos")).toBeDisabled();
  });

  it("asks for a note, not a reason, on a first plan", () => {
    renderScreen({ draft: { ...planningDraft, baseline: null } });
    expect(screen.getByLabelText("Nota (opcional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar como línea base v3" })).toBeEnabled();
  });
});
