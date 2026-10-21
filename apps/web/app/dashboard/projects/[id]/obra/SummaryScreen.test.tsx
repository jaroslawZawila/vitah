// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { control, header } from "../../../../../test/construction-fixture";
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
    expect(kpis.getByText("+8 d")).toBeInTheDocument();
    expect(kpis.getByText("06 Envolvente térmica Thermochip: fin previsto 09/10, sigue en curso")).toBeInTheDocument();
    // Planning is still simulated (labelled so); purchasing comes from Compras.
    expect(kpis.getAllByText("Simulado")).toHaveLength(1);
    expect(kpis.getAllByText("Compras").length).toBeGreaterThan(0);
  });

  it("warns about late deliveries without changing anything", () => {
    renderScreen();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("1 entrega con retraso: PED-049 Piedra de Liébana, capítulo 06, prevista el 14 oct. Solo es un aviso");
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
    expect(within(row).getByText("−440 · −1,4 %")).toBeInTheDocument();
    // Not contracted: a dash, never zero.
    const pending = within(table).getByRole("link", { name: "Electricidad e iluminación" }).closest("tr")!;
    expect(within(pending).getByText("empieza en 2 d")).toBeInTheDocument();
    expect(within(pending).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // An overrun is negative.
    const roof = within(table).getByRole("link", { name: "Cubierta inclinada" }).closest("tr")!;
    expect(within(roof).getByText("+2544 · +4,6 %")).toBeInTheDocument();
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
    expect(issues.getByText(/\+2350 € est\./)).toBeInTheDocument();

    const documents = within(screen.getByRole("region", { name: "Documentación" }));
    expect(documents.getByText("1 caduca")).toBeInTheDocument();
    expect(documents.getByText("Cubiertas del Saja")).toBeInTheDocument();

    const photos = within(screen.getByRole("region", { name: "Fotos de obra" }));
    expect(photos.getByRole("link", { name: "Ver las 148 →" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/fotos");
    expect(photos.getByRole("link", { name: "Subir fotos" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/fotos");
    expect(photos.getByRole("img", { name: "17/10 · 06 · Fachada norte" })).toHaveAttribute(
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
