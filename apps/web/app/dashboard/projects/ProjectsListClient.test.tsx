// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import ProjectsBackLink from "./components/ProjectsBackLink";
import ProjectsListClient from "./ProjectsListClient";
import { toProjectRows } from "./project-list";

// The app router's search params follow history.replaceState; jsdom's location stands in for them.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const projects = toProjectRows([
  {
    id: "p-1",
    ref: "VTH-1",
    address: "Calle Mayor 1, Santander",
    startDate: new Date("2026-03-01T00:00:00Z"),
    completionDate: null,
    obraStage: 6,
    client: { name: "Ana García", email: "ana@example.com" },
    budget: { revision: { number: 2, status: "accepted" }, generation: null },
    schedule: { status: "late", worst: "forecast", days: 101 },
    progressPct: 42,
    attention: [
      { kind: "to_invoice", count: 1 },
      { kind: "supplier_overdue", count: 2, amountCents: 1_234_500 },
      { kind: "requests", count: 3 },
    ],
  },
  {
    id: "p-2",
    ref: "VTH-2",
    address: "Calle del Sol 5, Santander",
    startDate: null,
    completionDate: null,
    obraStage: 3,
    client: null,
    budget: { revision: { number: 1, status: "issued" }, generation: null },
    schedule: null,
    progressPct: null,
    attention: [{ kind: "documents", count: 1 }],
  },
  {
    id: "p-3",
    ref: "VTH-3",
    address: "Paseo del Mar 2, Suances",
    startDate: null,
    completionDate: null,
    obraStage: 1,
    client: null,
    budget: { revision: null, generation: { status: "failed", step: 2 } },
    schedule: null,
    progressPct: null,
    attention: [],
  },
]);

const list = (rows = projects, canCreate = true) => (
  <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
    <ProjectsListClient projects={rows} canCreate={canCreate} />
  </NextIntlClientProvider>
);
const renderList = (rows = projects, canCreate = true) => render(list(rows, canCreate));
const goTo = (url: string) => window.history.replaceState(null, "", url);

const shownRefs = () =>
  screen
    .queryAllByRole("row")
    .slice(1)
    .map((row) => within(within(row).getAllByRole("cell")[0]!).getAllByRole("link")[0]!.textContent);
const budgetGroup = () => within(screen.getByRole("group", { name: "Presupuesto" }));
const obraGroup = () => within(screen.getByRole("group", { name: "Obra" }));
const attentionGroup = () => within(screen.getByRole("group", { name: "Atención" }));

afterEach(() => goTo("/dashboard/projects"));

describe("ProjectsListClient", () => {
  it("lists projects with their address, client, dates, budget and obra", () => {
    renderList();

    expect(screen.getByText("Todos (3)", { selector: "span" })).toBeInTheDocument();
    const [, first, second, third] = screen.getAllByRole("row");
    expect(within(first!).getByText("VTH-1")).toBeInTheDocument();
    expect(within(first!).getByText("Calle Mayor 1, Santander")).toBeInTheDocument();
    expect(within(first!).getByText("Ana García")).toBeInTheDocument();
    expect(within(first!).getByText("1 mar 2026")).toBeInTheDocument();
    expect(within(first!).getByRole("link", { name: "Rev.2 · Aceptada" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget");
    expect(within(first!).getByRole("link", { name: "Etapa 6 · Ejecución de obra" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra");
    expect(within(first!).getByRole("link", { name: "VTH-1" })).toHaveAttribute("href", "/dashboard/projects/p-1");
    expect(within(second!).getByText("Sin acceso a la app")).toBeInTheDocument();
    expect(within(second!).getByText("Rev.1 · Emitida")).toBeInTheDocument();
    expect(within(second!).getByText("Etapa 3 · Presupuesto")).toBeInTheDocument();
    // A failed AI run says so, rather than reading as no budget at all.
    expect(within(third!).getByText("La IA no terminó")).toBeInTheDocument();
  });

  it("shows each obra's schedule, built % and what needs attention, only where they apply", () => {
    renderList();
    const [, first, second, third] = screen.getAllByRole("row");

    expect(within(first!).getByRole("link", { name: "Con retraso · +101 d" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion");
    expect(within(first!).getByText("42 %")).toBeInTheDocument();
    expect(
      within(first!).getByRole("button", {
        // Money is formatted with a non-breaking space before the €.
        name: /^Qué necesita atención en VTH-1: 1 hito por facturar, 2 facturas de proveedor vencidas \(12\.345,00\s€\), 3 solicitudes de compra por aprobar$/,
      }),
    ).toHaveTextContent("6 avisos");
    // No contract: no schedule nor progress; a CAE warning still counts.
    expect(within(second!).queryByText(/plazo|retraso|Sin plan/i)).not.toBeInTheDocument();
    expect(within(second!).queryByText(/%$/)).not.toBeInTheDocument();
    expect(within(second!).getByRole("button", { name: /1 aviso de documentación CAE/ })).toHaveTextContent("1 aviso");
    expect(within(third!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the reasons, each a link to where it is handled", async () => {
    renderList();
    const [, first] = screen.getAllByRole("row");
    fireEvent.click(within(first!).getByRole("button", { name: /Qué necesita atención en VTH-1/ }));

    expect(await screen.findByRole("link", { name: "1 hito por facturar" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/hitos");
    expect(screen.getByRole("link", { name: /^2 facturas de proveedor vencidas \(12\.345,00\s€\)$/ })).toHaveAttribute(
      "href",
      "/dashboard/compras/facturas?estado=overdue&obra=p-1",
    );
    expect(screen.getByRole("link", { name: "3 solicitudes de compra por aprobar" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/compras?vista=solicitudes",
    );
  });

  it("filters by what needs attention, most urgent first, and keeps it in the URL", () => {
    renderList();
    expect(attentionGroup().getByRole("button", { name: /^Necesitan atención\s*2$/ })).toBeInTheDocument();
    expect(attentionGroup().getByRole("button", { name: /^Con retraso\s*1$/ })).toBeInTheDocument();

    fireEvent.click(attentionGroup().getByRole("button", { name: /Necesitan atención/ }));
    expect(shownRefs()).toEqual(["VTH-1", "VTH-2"]);
    expect(window.location.search).toBe("?atencion=attention");
    // The other filters count what it lets through.
    expect(budgetGroup().getByRole("button", { name: /^Todos\s*2$/ })).toBeInTheDocument();

    fireEvent.click(attentionGroup().getByRole("button", { name: /Con retraso/ }));
    expect(shownRefs()).toEqual(["VTH-1"]);
    expect(window.location.search).toBe("?atencion=late");
  });

  it("opens with the Atención filter from the URL", () => {
    goTo("/dashboard/projects?atencion=late&obra=not_started");
    renderList();

    expect(screen.getByText("Ningún proyecto coincide con estos filtros.")).toBeInTheDocument();
  });

  it("filters by budget and obra, with each option's count, and keeps them in the URL", () => {
    renderList();
    expect(budgetGroup().getByRole("button", { name: /^Aceptados\s*1$/ })).toBeInTheDocument();
    expect(obraGroup().getByRole("button", { name: /^En obra\s*1$/ })).toBeInTheDocument();

    fireEvent.click(obraGroup().getByRole("button", { name: /Sin empezar/ }));
    expect(shownRefs()).toEqual(["VTH-2", "VTH-3"]);
    expect(screen.getByText("2 de 3 proyectos")).toBeInTheDocument();
    expect(window.location.search).toBe("?obra=not_started");
    // The budget's counts follow the obra filter.
    expect(budgetGroup().getByRole("button", { name: /^Aceptados\s*0$/ })).toBeInTheDocument();

    fireEvent.click(budgetGroup().getByRole("button", { name: /Emitidos/ }));
    expect(shownRefs()).toEqual(["VTH-2"]);
    expect(window.location.search).toBe("?presupuesto=issued&obra=not_started");
  });

  it("files a failed AI run under no budget", () => {
    renderList();

    fireEvent.click(budgetGroup().getByRole("button", { name: /Sin presupuesto/ }));
    expect(shownRefs()).toEqual(["VTH-3"]);
  });

  it("filters on phones through a select each", () => {
    renderList();

    fireEvent.change(screen.getByRole("combobox", { name: "Presupuesto" }), { target: { value: "accepted" } });
    expect(shownRefs()).toEqual(["VTH-1"]);
    expect(screen.getByRole("option", { name: "Aceptados (1)" })).toBeInTheDocument();
  });

  it("searches by code, client or address", () => {
    renderList();

    fireEvent.change(screen.getByRole("searchbox", { name: "Código, cliente o dirección" }), { target: { value: "garcia" } });
    expect(shownRefs()).toEqual(["VTH-1"]);
    expect(window.location.search).toBe("?q=garcia");
  });

  it("opens with the URL's filters, and clears them when nothing matches", () => {
    goTo("/dashboard/projects?presupuesto=rejected");
    renderList();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Ningún proyecto coincide con estos filtros.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Quitar filtros" })[0]!);
    expect(shownRefs()).toEqual(["VTH-1", "VTH-2", "VTH-3"]);
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("follows a navigation to the list with other filters, such as the rail's Proyectos", () => {
    const { rerender } = renderList();
    fireEvent.click(budgetGroup().getByRole("button", { name: /Emitidos/ }));
    expect(shownRefs()).toEqual(["VTH-2"]);

    goTo("/dashboard/projects");
    rerender(list());
    expect(shownRefs()).toEqual(["VTH-1", "VTH-2", "VTH-3"]);
  });

  it("has Volver a proyectos go back to the list as it was last filtered", () => {
    const { unmount } = renderList();
    fireEvent.click(obraGroup().getByRole("button", { name: /En obra/ }));
    unmount();

    render(<ProjectsBackLink label="Volver a proyectos" />);
    expect(screen.getByRole("link", { name: "← Volver a proyectos" })).toHaveAttribute("href", "/dashboard/projects?obra=execution");
  });

  it("shows an empty state", () => {
    renderList([]);

    expect(screen.getByText("Todavía no hay proyectos.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("links to the new-project flow", () => {
    renderList();

    expect(screen.getByRole("link", { name: "+ Nuevo Proyecto" })).toHaveAttribute("href", "/dashboard/projects/new");
  });

  it("hides the new-project flow from viewers", () => {
    renderList(projects, false);

    expect(screen.queryByRole("link", { name: "+ Nuevo Proyecto" })).not.toBeInTheDocument();
  });
});
