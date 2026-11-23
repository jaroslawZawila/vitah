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

    // The first figures, all without VAT: the total budgeted (margins in), the current cost, the global value.
    const figures = within(screen.getByRole("region", { name: "Cifras de la obra" }));
    const card = (label: string) => figures.getByText(label).parentElement!;
    expect(card("Total presupuestado · sin IVA")).toHaveTextContent("621.480,00 €");
    expect(card("Total presupuestado · sin IVA")).toHaveTextContent("Precio del contrato, con gastos asociados y beneficio industrial · Rev.1");
    expect(card("Coste actual · sin IVA")).toHaveTextContent("150.000,00 €");
    expect(card("Coste actual · sin IVA")).toHaveTextContent("Facturado por proveedores en Compras");
    expect(card("Valor global · sin IVA")).toHaveTextContent("471.480,00 € · 75,86 %");
    // The old four cards are gone: the chapters, cost, sales and schedule have their own tabs.
    expect(screen.queryByRole("region", { name: "Indicadores" })).not.toBeInTheDocument();
    expect(screen.queryByText("Coste · sin IVA")).not.toBeInTheDocument();
    expect(screen.queryByText("Venta · sin IVA")).not.toBeInTheDocument();
    expect(screen.queryByText("Finalizados con retraso")).not.toBeInTheDocument();
    expect(screen.queryByText("de 6 finalizados")).not.toBeInTheDocument();
  });

  it("shows a global value below zero when the cost passes the budget", () => {
    renderScreen({
      control: { ...control, cost: { ...control.cost, supplierInvoicedCents: 70_000_000 }, globalValue: { cents: -7_852_000, bp: -1_263 } },
    });
    const figures = within(screen.getByRole("region", { name: "Cifras de la obra" }));
    expect(figures.getByText("Valor global · sin IVA").parentElement).toHaveTextContent("−78.520,00 € · −12,63 %");
  });

  it("keeps the table's footnote on cost and chapter 20", () => {
    renderScreen();
    expect(screen.getByText(/^Importes en euros, a coste y sin IVA\. Imprevistos \(cap\. 20, .+ €\) quedan como reserva, fuera del total\./)).toBeInTheDocument();
  });

  it("warns about late deliveries without changing anything", () => {
    renderScreen();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("1 entrega con retraso: PED-049 Piedra de Liébana, capítulo 06, prevista el 14 oct 2026. Solo es un aviso");
    expect(within(banner).getByRole("link", { name: "PED-049" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-49");
  });

  it("lists the chapters in one list, in their order, with schedule and deviation", () => {
    renderScreen();

    const table = screen.getByRole("table", { name: "Capítulos del presupuesto" });
    // One list, not grouped by state: every chapter in the order it comes.
    expect(chapterRows()).toEqual(control.chapters.map((c) => c.name));
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

  it("on a phone, lists the chapters as items: name linking over the item, state, dates, schedule and money", () => {
    renderScreen();

    // The phone's list sits beside the table (CSS picks one): one list too, in the same order.
    const phone = (name: string) =>
      screen
        .getAllByRole("link", { name })
        .find((link) => !link.closest("table"))!
        .closest("li")!;
    const items = screen.getAllByRole("listitem").filter((item) => item.querySelector("a[href*='/obra/avance/']"));
    expect(items.map((item) => item.querySelector("a")!.textContent)).toEqual(control.chapters.map((c) => c.name));

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

    // The period filter applies to the list too.
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } });
    expect(screen.queryAllByRole("link", { name: "Envolvente térmica Thermochip" })).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Electricidad e iluminación" })).toHaveLength(2);
  });

  it("filters the chapters by period only: no chapter or state filter", () => {
    renderScreen();
    expect(chapterRows()).toHaveLength(6);
    expect(screen.queryByRole("group", { name: "Estado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Capítulo" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } });
    // Only what runs after 1 Nov: 04 (to 27 Nov), 13 and 12; finished and late 06 don't.
    expect(chapterRows()).toEqual(["Albañilería y saneamiento", "Electricidad e iluminación", "Climatización y VMC"]);
  });

  it("shows the next payment hito, open issues and document alerts, and no photos", () => {
    renderScreen();

    // H3 is invoiced but not collected yet: it is the next payment; H4 and H6 come after it.
    const hito = within(screen.getByRole("region", { name: "Próximo hito de pago" }));
    expect(hito.getByText("H3")).toBeInTheDocument();
    expect(hito.getByText("Estructura Steel Frame")).toBeInTheDocument();
    expect(hito.getByText("Facturado")).toBeInTheDocument();
    expect(hito.getByText("Importe · sin IVA").nextElementSibling).toHaveTextContent("93.222,00 €");
    expect(hito.getByText("Capítulos finalizados").nextElementSibling).toHaveTextContent("1 de 1");
    expect(hito.queryByText("H4")).not.toBeInTheDocument();
    expect(hito.queryByText("H6")).not.toBeInTheDocument();
    expect(hito.getByRole("link", { name: "Ver hitos →" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/hitos");

    const issues = within(screen.getByRole("region", { name: "Incidencias y cambios abiertos" }));
    expect(issues.getByText(/Corredera elevable/)).toBeInTheDocument();
    expect(issues.getByText(/\+2.350,00 € est\./)).toBeInTheDocument();

    const documents = within(screen.getByRole("region", { name: "Documentación" }));
    expect(documents.getByText("1 caduca")).toBeInTheDocument();
    expect(documents.getByText("Cubiertas del Saja")).toBeInTheDocument();

    // Photos are on Obra › Fotos only.
    expect(screen.queryByRole("region", { name: "Fotos de obra" })).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("counts the later hitos already owed, and leaves out the chapters of a hito that closes none", () => {
    const [h3, h4, h6] = control.milestones;
    renderScreen({
      control: {
        ...control,
        milestones: [
          { ...h3!, state: "pending", chapters: [] },
          { ...h4!, state: "requested" },
          { ...h6!, state: "invoiced" },
        ],
      },
    });
    const hito = within(screen.getByRole("region", { name: "Próximo hito de pago" }));
    expect(hito.getByText("H3")).toBeInTheDocument();
    expect(hito.queryByText("Capítulos finalizados")).not.toBeInTheDocument();
    expect(hito.getByText("2 hitos más alcanzados o facturados sin cobrar")).toBeInTheDocument();
  });

  it("says so when every hito is collected", () => {
    renderScreen({ control: { ...control, milestones: control.milestones.map((m) => ({ ...m, state: "collected" as const })) } });
    const hito = within(screen.getByRole("region", { name: "Próximo hito de pago" }));
    expect(hito.getByText("Todos los hitos están cobrados.")).toBeInTheDocument();
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
  });

  it("points to the budget before one is accepted", () => {
    renderScreen({ control: { ...control, budget: null, chapters: [] } });
    expect(screen.getByRole("heading", { name: "Todavía no hay presupuesto aceptado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al presupuesto" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget");
  });
});
