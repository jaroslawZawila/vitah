// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
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
    expect(router.push).toHaveBeenCalledWith(PLAN);
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
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText("Festivos autonómicos"), "md");
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(actions.updatePlanningDraftAction).toHaveBeenCalledWith("p-1", expect.objectContaining({ region: "md" }));

    await userEvent.click(screen.getByRole("button", { name: "Descartar borrador" }));
    expect(window.confirm).toHaveBeenCalledWith("¿Descartar el borrador v3? Se pierden sus cambios.");
    expect(actions.discardPlanningDraftAction).toHaveBeenCalledWith("p-1");
    expect(router.push).toHaveBeenCalledWith(PLAN);
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
    expect(screen.getByLabelText("Festivos autonómicos")).toBeDisabled();
  });

  it("asks for a note, not a reason, on a first plan", () => {
    renderScreen({ draft: { ...planningDraft, baseline: null } });
    expect(screen.getByLabelText("Nota (opcional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar como línea base v3" })).toBeEnabled();
    expect(screen.queryByRole("columnheader", { name: "Vs. v2" })).not.toBeInTheDocument();
  });
});
