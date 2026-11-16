// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleStatus, type ControlChapter, type PlanningCheck } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import { control, controlChapter, header } from "../../../../../test/construction-fixture";
import SummaryScreen from "./SummaryScreen";

vi.mock("../../../../actions/construction", () => ({ reviewChangesAction: vi.fn() }));
const actions = await import("../../../../actions/construction");

function renderScreen(props: Partial<Parameters<typeof SummaryScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <SummaryScreen projectId="p-1" header={header} control={control} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

const chapterRows = () => {
  const table = screen.getByRole("table", { name: "Capítulos del presupuesto" });
  return within(table)
    .getAllByRole("link")
    .map((link) => link.textContent);
};

beforeEach(() => vi.mocked(actions.reviewChangesAction).mockReset().mockResolvedValue({ success: true }));

describe("SummaryScreen", () => {
  it("shows the project, the sub-navigation and the key figures", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Obra" })).toBeInTheDocument();
    expect(screen.getByText("Etapa 6 · Ejecución de obra")).toBeInTheDocument();
    expect(screen.getByText("Marta Ruiz Gómez")).toBeInTheDocument();
    expect(screen.getByText("004/2026 Rev.1 · aceptada")).toBeInTheDocument();

    const tabs = within(screen.getByRole("navigation", { name: "Secciones de obra" }));
    expect(tabs.getByRole("link", { current: "page" })).toHaveTextContent("Resumen");
    expect(tabs.getByRole("link", { name: /Incidencias\s*2/ })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/incidencias");

    const kpis = within(screen.getByRole("region", { name: "Indicadores" }));
    expect(kpis.getByText("de 6 finalizados")).toBeInTheDocument();
    // Planning is still simulated (labelled so): the schedule says so instead of "on time"; purchasing comes from Compras.
    expect(kpis.getByText("Sin plan")).toBeInTheDocument();
    expect(kpis.queryByText("En plazo")).not.toBeInTheDocument();
    expect(kpis.getByText(/No hay plan aprobado, así que no se puede decir si la obra va en plazo/)).toBeInTheDocument();
    expect(kpis.getByText("Según las fechas simuladas:")).toBeInTheDocument();
    expect(
      kpis.getByText("1 capítulo en curso ha pasado su fin previsto: 06 Envolvente térmica Thermochip, fin previsto 9 oct 2026."),
    ).toBeInTheDocument();
    expect(kpis.getAllByText("Simulado")).toHaveLength(1);
    expect(kpis.getAllByText("Compras").length).toBeGreaterThan(0);
  });

  it("says which VAT the money is in, and that the cost leaves chapter 20 out", () => {
    renderScreen();
    const kpis = within(screen.getByRole("region", { name: "Indicadores" }));
    expect(kpis.getByText("Coste · sin IVA")).toBeInTheDocument();
    expect(kpis.getByText("Venta · sin IVA")).toBeInTheDocument();
    // The budget's cost total counts chapter 20; the obra's doesn't: the reserve reconciles them.
    expect(kpis.getByText("Sin el cap. 20 (imprevistos, 24.759,00 €): queda como reserva.")).toBeInTheDocument();
    expect(screen.getByText(/^Importes en euros, a coste y sin IVA\. Imprevistos \(cap\. 20, .+ €\) quedan como reserva, fuera del total\./)).toBeInTheDocument();
  });

  describe("the schedule, with an approved plan", () => {
    const live = (chapters: ControlChapter[], forecast: PlanningCheck) =>
      renderScreen({
        control: {
          ...control,
          chapters,
          sources: { planning: "live", purchasing: "live" },
          schedule: scheduleStatus({ chapters, planning: "live", forecast, today: control.today }),
        },
      });
    const schedule = () => within(screen.getByRole("region", { name: "Indicadores" }));
    const withinContract = { endDate: "2027-03-01", contractEnd: "2027-03-31", delayDays: -30, penaltyCents: 0 };
    const onPlan = [controlChapter({ overdueDays: null, plannedEnd: "2026-10-30" })];
    // Chapter 17 spans the works: planned from the start, never recorded as started.
    const notStarted = controlChapter({
      code: "17",
      name: "Control de calidad",
      state: "pending",
      plannedStart: "2026-02-10",
      plannedEnd: "2027-03-01",
      actualStart: null,
      overdueDays: null,
    });

    it("is on time only when nothing contradicts it", () => {
      live(onPlan, withinContract);
      expect(schedule().getByText("En plazo")).toBeInTheDocument();
      expect(schedule().getByText("ningún capítulo va tarde")).toBeInTheDocument();
      expect(schedule().getByText("Fin previsto 1 mar 2027, dentro del contrato (31 mar 2027).")).toBeInTheDocument();
    });

    it("is late when a chapter's planned start has passed, even with nothing in progress late", () => {
      live([...onPlan, notStarted], withinContract);
      expect(schedule().queryByText("En plazo")).not.toBeInTheDocument();
      expect(schedule().getByText("+249 d")).toBeInTheDocument();
      expect(schedule().getByText("inicio previsto superado")).toBeInTheDocument();
      expect(
        schedule().getByText("1 capítulo sin empezar ha pasado su inicio previsto: 17 Control de calidad, inicio previsto 10 feb 2026."),
      ).toBeInTheDocument();
    });

    it("leads with a forecast past the contract and its penalty", () => {
      live([...onPlan, notStarted], { endDate: "2027-07-10", contractEnd: "2027-03-31", delayDays: 101, penaltyCents: 1_305_000 });
      expect(schedule().getByText("+101 d")).toBeInTheDocument();
      expect(schedule().getByText("sobre el contrato")).toBeInTheDocument();
      expect(schedule().getByText("Fin previsto 10 jul 2027: 101 días después del contrato (31 mar 2027).")).toBeInTheDocument();
      expect(schedule().getByText(/^Penalización prevista: 13\.050,00\s€\.$/)).toBeInTheDocument();
      expect(schedule().getByText(/^1 capítulo sin empezar ha pasado su inicio previsto/)).toBeInTheDocument();
    });
  });

  it("warns about late deliveries without changing anything", () => {
    renderScreen();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("1 entrega con retraso: PED-049 Piedra de Liébana, capítulo 06, prevista el 14 oct 2026. Solo es un aviso");
    expect(within(banner).getByRole("link", { name: "PED-049" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-49");
  });

  it("groups the chapters by state, with schedule and deviation", () => {
    renderScreen();

    const table = screen.getByRole("table", { name: "Capítulos del presupuesto" });
    expect(within(table).getByText("En curso · 2")).toBeInTheDocument();
    expect(within(table).getByText("Pendientes · 2")).toBeInTheDocument();
    const row = within(table).getByRole("link", { name: "Envolvente térmica Thermochip" }).closest("tr")!;
    expect(row.querySelector("a")).toHaveAttribute("href", "/dashboard/projects/p-1/obra/avance/06");
    expect(within(row).getByText("Fin superado +8 d")).toBeInTheDocument();
    // The amount over its share, stacked to keep the column narrow.
    expect(within(row).getByText("−440,00")).toContainElement(within(row).getByText("−1,4 %"));
    // Not contracted: a dash, never zero.
    const pending = within(table).getByRole("link", { name: "Electricidad e iluminación" }).closest("tr")!;
    expect(within(pending).getByText("empieza en 2 d")).toBeInTheDocument();
    expect(within(pending).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // An overrun is negative.
    const roof = within(table).getByRole("link", { name: "Cubierta inclinada" }).closest("tr")!;
    expect(within(roof).getByText("+2.544,00")).toContainElement(within(roof).getByText("+4,6 %"));
  });

  it("on a phone, lists the chapters as items: name linking over the item, state, dates, schedule and money", async () => {
    renderScreen();

    // The phone's list sits beside the table (CSS picks one), grouped by state the same way.
    const phone = (name: string) =>
      screen
        .getAllByRole("link", { name })
        .find((link) => !link.closest("table"))!
        .closest("li")!;
    expect(screen.getAllByRole("region", { name: "En curso · 2" })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3, name: "En curso · 2" })).toHaveLength(1);

    const envelope = phone("Envolvente térmica Thermochip");
    expect(within(envelope).getByRole("link")).toHaveAttribute("href", "/dashboard/projects/p-1/obra/avance/06");
    expect(within(envelope).getByRole("link").className).toContain("after:inset-0");
    expect(envelope).toHaveClass("relative");
    expect(within(envelope).getByText("En curso")).toBeInTheDocument();
    expect(within(envelope).getByText("Fin superado +8 d")).toBeInTheDocument();
    expect(envelope).toHaveTextContent("Hito H4");
    expect(envelope).toHaveTextContent("Plan14 sept 2026 – 9 oct 2026");
    expect(envelope).toHaveTextContent("Real21 sept 2026 – …");
    expect(within(envelope).getByText("Coste presup.").nextElementSibling).toHaveTextContent("34.840,00");
    expect(within(envelope).getByText("Contratado").nextElementSibling).toHaveTextContent("30.400,00 6/9");
    expect(within(envelope).getByText("−440,00").closest("span.block")).toHaveClass("text-good");
    expect(within(envelope).getByText("· −1,4 %")).toBeInTheDocument();

    // Pending: no actual dates, nothing contracted (a dash, never a zero).
    const pending = phone("Electricidad e iluminación");
    expect(pending).not.toHaveTextContent("Real");
    expect(within(pending).getByText("empieza en 2 d")).toBeInTheDocument();
    expect(within(pending).getByText("Contratado").nextElementSibling).toHaveTextContent("—");

    // Filtering applies to the list too.
    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: "Finalizado" }));
    expect(screen.queryAllByRole("link", { name: "Envolvente térmica Thermochip" })).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Cubierta inclinada" })).toHaveLength(2);
  });

  it("filters the chapters by chapter, state and period", async () => {
    renderScreen();
    expect(chapterRows()).toHaveLength(6);

    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: "Finalizado" }));
    expect(chapterRows()).toEqual(["Cubierta inclinada", "Carpintería exterior e interior"]);

    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: "Todos" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Capítulo" }), "13");
    expect(chapterRows()).toEqual(["Electricidad e iluminación"]);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Capítulo" }), "all");
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } });
    // Only what runs after 1 Nov: 04 (to 27 Nov), 13 and 12; finished and late 06 don't.
    expect(chapterRows()).toEqual(["Albañilería y saneamiento", "Electricidad e iluminación", "Climatización y VMC"]);
  });

  it("shows hitos, open issues, document alerts and recent photos", () => {
    renderScreen();

    const hitos = within(screen.getByRole("region", { name: "Hitos de pago" }));
    expect(hitos.getByText("· 2 de 3 cap.")).toBeInTheDocument();
    expect(hitos.getByRole("link", { name: "Ver hitos →" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/hitos");

    const issues = within(screen.getByRole("region", { name: "Incidencias y cambios abiertos" }));
    expect(issues.getByText(/Corredera elevable/)).toBeInTheDocument();
    expect(issues.getByText(/\+2.350,00 € est\./)).toBeInTheDocument();

    const documents = within(screen.getByRole("region", { name: "Documentación" }));
    expect(documents.getByText("1 caduca")).toBeInTheDocument();
    expect(documents.getByText("Cubiertas del Saja")).toBeInTheDocument();

    const photos = within(screen.getByRole("region", { name: "Fotos de obra" }));
    expect(photos.getByRole("link", { name: "Ver las 148 →" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/fotos");
    expect(photos.getByRole("link", { name: "Subir fotos" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/fotos");
    expect(photos.getByRole("img", { name: "17 oct 2026 · 06 · Fachada norte" })).toHaveAttribute(
      "src",
      "/api/v1/projects/p-1/photos/photo-1?size=thumb",
    );
  });

  it("asks to review chapters the accepted revision added or removed", async () => {
    renderScreen({
      control: {
        ...control,
        reviewPending: true,
        removedChapters: [{ code: "15", name: "Protección contra incendios", actualStart: null, actualEnd: null }],
      },
    });

    const banner = within(screen.getByRole("region", { name: "La revisión aceptada cambia los capítulos del contrato" }));
    expect(banner.getByText("12 Climatización y VMC")).toBeInTheDocument();
    expect(banner.getByText("Protección contra incendios")).toBeInTheDocument();
    await userEvent.click(banner.getByRole("button", { name: "Marcar como revisado" }));
    expect(actions.reviewChangesAction).toHaveBeenCalledWith("p-1");
  });

  it("shows why reviewing failed", async () => {
    vi.mocked(actions.reviewChangesAction).mockResolvedValue({ error: "no_budget" });
    renderScreen({ control: { ...control, reviewPending: true } });

    await userEvent.click(screen.getByRole("button", { name: "Marcar como revisado" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Todavía no hay un presupuesto aceptado.");
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false, control: { ...control, reviewPending: true } });
    expect(screen.queryByRole("button", { name: "Marcar como revisado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Subir fotos" })).not.toBeInTheDocument();
  });

  it("points to the budget before one is accepted", () => {
    renderScreen({ control: { ...control, budget: null, chapters: [] } });
    expect(screen.getByRole("heading", { name: "Todavía no hay presupuesto aceptado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al presupuesto" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget");
  });
});
