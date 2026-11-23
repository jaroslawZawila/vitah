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
  it("shows each chapter's rule, the dates it gives and the change against the baseline", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Editar el plan" })).toBeInTheDocument();
    expect(screen.getByText("Borrador v3 · sin aprobar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Volver" })).toHaveAttribute("href", PLAN);
    expect(screen.getByRole("columnheader", { name: "Vs. v2" })).toBeInTheDocument();

    // Finished and started chapters keep what Avance recorded.
    expect(row(/Actuaciones previas/).getByText("Terminado · fechas reales de Avance")).toBeInTheDocument();
    expect(row(/Actuaciones previas/).getByLabelText("Días laborables del capítulo 01")).toBeDisabled();
    expect(row(/Cimentación/).getByLabelText("Cuándo empieza el capítulo 02")).toBeDisabled();
    expect(row(/Cimentación/).getByLabelText("Días laborables del capítulo 02")).toBeEnabled();

    expect(row(/Pinturas/).getByLabelText("Cuándo empieza el capítulo 04")).toHaveValue("03");
    expect(row(/Pinturas/).getByLabelText(/Desfase en días laborables del capítulo 04/)).toHaveValue(0);
    expect(screen.getByText(/Durante toda la obra, hasta el .*: 17 Control de calidad/)).toBeInTheDocument();
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
    expect(labels).toEqual(["Empieza", "Desfase / fecha", "Días", "Inicio – fin", "Pedido", "Vs. v2"]);
    const days = within(painting).getByLabelText("Días laborables del capítulo 04");
    expect(days.closest("td")).toHaveClass("max-md:col-span-2", "max-md:flex");
    expect(screen.getAllByLabelText("Días laborables del capítulo 04")).toHaveLength(1);
  });

  it("recomputes the dates as staff type, then approves with the reason", async () => {
    renderScreen();
    const painting = () => row(/Pinturas/);
    const before = painting().getAllByRole("cell")[5]!.textContent;
    await userEvent.clear(painting().getByLabelText("Días laborables del capítulo 04"));
    await userEvent.type(painting().getByLabelText("Días laborables del capítulo 04"), "20");
    expect(painting().getAllByRole("cell")[5]!.textContent).not.toBe(before);

    const approve = screen.getByRole("button", { name: "Aprobar como línea base v3" });
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Motivo del cambio"), "Retraso de la bomba de calor");
    await userEvent.click(approve);
    expect(actions.approvePlanningDraftAction).toHaveBeenCalledWith(
      "p-1",
      {
        items: expect.arrayContaining([expect.objectContaining({ code: "04", after: "03", durationDays: 20 })]),
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

  it("sets how far ahead a chapter is ordered, showing the order-by date", async () => {
    renderScreen();
    const lead = row(/Pinturas/).getByLabelText("Días de antelación del pedido del capítulo 04");
    expect(lead).toHaveValue(14);
    const orderBy = () => row(/Pinturas/).getByText(/^antes del /).textContent;
    const before = orderBy();
    await userEvent.clear(lead);
    await userEvent.type(lead, "42");
    expect(orderBy()).not.toBe(before);
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(actions.updatePlanningDraftAction).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ code: "04", leadDays: 42 })]) }),
    );
    // A finished chapter's orders are history.
    expect(row(/Actuaciones previas/).getByLabelText("Días de antelación del pedido del capítulo 01")).toBeDisabled();
  });

  it("moves a chapter up and down the list, whole, and saves the new order", async () => {
    renderScreen();
    const arrow = (name: string) => screen.getByRole("button", { name });
    expect(order()).toEqual(["01", "02", "03", "04"]);
    // The ends of the list go no further; 17 spans the works and has no arrows.
    expect(arrow("Subir el capítulo 01")).toBeDisabled();
    expect(arrow("Bajar el capítulo 04")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Subir el capítulo 17" })).not.toBeInTheDocument();
    // The arrows sit beside the chapter's name: at the card's top right on a phone.
    expect(arrow("Subir el capítulo 04").closest("td")).toBe(row(/Pinturas/).getAllByRole("cell")[1]);

    await userEvent.click(arrow("Subir el capítulo 04"));
    expect(order()).toEqual(["01", "02", "04", "03"]);
    // The arrow keeps the focus, to press it again; the row keeps its rule.
    expect(arrow("Subir el capítulo 04")).toHaveFocus();
    expect(row(/Pinturas/).getByLabelText("Cuándo empieza el capítulo 04")).toHaveValue("03");

    await userEvent.click(arrow("Subir el capítulo 04"));
    await userEvent.click(arrow("Subir el capítulo 04"));
    // First now: its "up" is disabled, so its pair takes the focus.
    expect(arrow("Subir el capítulo 04")).toBeDisabled();
    expect(arrow("Bajar el capítulo 04")).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    const sent = vi.mocked(actions.updatePlanningDraftAction).mock.calls[0]![1] as { items: { code: string; after: string | null }[] };
    expect(sent.items.map((i) => i.code)).toEqual(["04", "01", "02", "03", "17"]);
    expect(sent.items[0]).toMatchObject({ code: "04", after: "03" });
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
    expect(row(/Pinturas/).getByLabelText("Cuándo empieza el capítulo 04")).toHaveValue("03");
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

  it("refuses chapters that wait for each other", async () => {
    renderScreen();
    await userEvent.selectOptions(row(/Revestimientos/).getByLabelText("Cuándo empieza el capítulo 03"), "04");
    expect(screen.getByRole("alert")).toHaveTextContent("se esperan unos a otros en círculo");
    expect(screen.getByRole("button", { name: "Guardar borrador" })).toBeDisabled();
  });

  it("keeps a fixed date chosen while the plan can't be scheduled", async () => {
    renderScreen();
    await userEvent.selectOptions(row(/Revestimientos/).getByLabelText("Cuándo empieza el capítulo 03"), "04");
    await userEvent.selectOptions(row(/Pinturas/).getByLabelText("Cuándo empieza el capítulo 04"), "fixed");
    expect(row(/Pinturas/).getByLabelText("Fecha de inicio del capítulo 04")).toHaveValue("2026-03-02");
  });

  it("can start a chapter on a fixed date", async () => {
    renderScreen();
    await userEvent.selectOptions(row(/Pinturas/).getByLabelText("Cuándo empieza el capítulo 04"), "fixed");
    // It starts where the rule had it, now as a fixed day.
    expect((row(/Pinturas/).getByLabelText("Fecha de inicio del capítulo 04") as HTMLInputElement).value).toMatch(/^2026-1[12]-/);
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(actions.updatePlanningDraftAction).toHaveBeenCalledWith(
      "p-1",
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ code: "04", after: null })]) }),
    );
    expect(await screen.findByText("Borrador guardado.")).toBeInTheDocument();
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
    expect(screen.queryByRole("columnheader", { name: "Vs. v2" })).not.toBeInTheDocument();
  });
});
