// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { BudgetOverview } from "@repo/core/contract";
import messages from "../../../../messages/es.json";
import { budgetsOverview } from "../../../../test/budgets-fixture";
import BudgetsScreen from "./BudgetsScreen";

function renderScreen(overview: BudgetOverview = budgetsOverview) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid" now={new Date("2026-11-01T10:00:00Z")}>
      <BudgetsScreen overview={overview} />
    </NextIntlClientProvider>,
  );
}

const table = () => within(screen.getByRole("table", { name: "Presupuestos de las obras" }));
const refs = () => table().getAllByRole("link", { name: /^Presupuesto de/ }).map((l) => l.textContent?.slice(0, 10));

describe("BudgetsScreen", () => {
  it("shows every obra's budget with what it waits for, and the totals", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Presupuestos" })).toBeInTheDocument();
    expect(refs()).toEqual(["VTH-26-003", "VTH-26-002", "VTH-26-004", "VTH-26-001", "VTH-26-005"]);

    const row = (ref: string) => within(table().getByRole("link", { name: `Presupuesto de ${ref}` }).closest("tr")!);
    expect(row("VTH-26-003").getByText("Rev.0 · Borrador")).toBeInTheDocument();
    expect(row("VTH-26-003").getByText("4 comprobaciones por revisar")).toBeInTheDocument();
    expect(row("VTH-26-003").getByText(/\+6,1 % vs media/)).toBeInTheDocument();
    expect(row("VTH-26-002").getByText("Vence en 5 días")).toBeInTheDocument();
    expect(row("VTH-26-004").getByText("IA en marcha")).toBeInTheDocument();
    expect(row("VTH-26-004").getByText("Paso 3 de 5")).toBeInTheDocument();
    expect(row("VTH-26-001").getByText(/Contrato 503\.110,00/)).toBeInTheDocument();
    expect(row("VTH-26-001").getByText("El 14 oct 2026 · 2 opciones elegidas")).toBeInTheDocument();
    expect(row("VTH-26-005").getByText("Sin presupuesto", { selector: "div" })).toBeInTheDocument();
    // Activity within a week reads relative.
    expect(row("VTH-26-001").getByText("hace 2 días")).toBeInTheDocument();

    expect(screen.getByText("2 borradores")).toBeInTheDocument();
    expect(screen.getByText("1 vence en 7 días o ya venció")).toBeInTheDocument();
  });

  it("opens an obra's budget from its row and its project from its link", () => {
    renderScreen();
    expect(table().getByRole("link", { name: "Presupuesto de VTH-26-002" })).toHaveAttribute("href", "/dashboard/projects/p-2/budget");
    expect(table().getByRole("link", { name: "Abrir el proyecto VTH-26-002" })).toHaveAttribute("href", "/dashboard/projects/p-2");
  });

  it("filters by status and by code, client or address", async () => {
    renderScreen();
    const filters = within(screen.getByRole("group", { name: "Filtrar por estado" }));
    await userEvent.click(filters.getByRole("button", { name: /Borrador/ }));
    expect(refs()).toEqual(["VTH-26-003", "VTH-26-004"]);
    await userEvent.click(filters.getByRole("button", { name: /Todas/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Código, cliente o dirección" }), "tres cantos");
    expect(refs()).toEqual(["VTH-26-002"]);
    expect(filters.getByRole("button", { name: /Emitidos/ })).toHaveTextContent("1");
    await userEvent.click(filters.getByRole("button", { name: /Aceptados/ }));
    expect(screen.getAllByText("Ninguna obra coincide con la búsqueda.").length).toBeGreaterThan(0);
  });

  it("says when there are no obras yet", () => {
    renderScreen({ items: [], summary: { ...budgetsOverview.summary, drafts: 0, generating: 0 } });
    expect(screen.getAllByText("Todavía no hay obras.").length).toBeGreaterThan(0);
    expect(screen.getByText("Nada por emitir")).toBeInTheDocument();
  });
});
