// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../messages/es.json";
import { costs, header } from "../../../../../../test/construction-fixture";
import CostsScreen from "./CostsScreen";

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <CostsScreen projectId="p-1" header={header} costs={costs} budgetNumber={1} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

const lines = () =>
  within(screen.getByRole("region", { name: "Partidas" }))
    .queryAllByRole("row")
    .map((row) => row.querySelector("td")?.textContent)
    .filter((code): code is string => !!code && /^\d+\.\d+$/.test(code));

const row = (text: string) => screen.getByText(text).closest("tr")!;

describe("CostsScreen", () => {
  it("compares each line's cost with what Compras contracted, chapters in progress open", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Costes por partida" })).toBeInTheDocument();
    expect(screen.getByText("Presupuesto Rev.1")).toBeInTheDocument();
    // Purchasing is real now: no "Simulado" anywhere.
    expect(screen.getByText("Real")).toBeInTheDocument();
    expect(screen.queryByText("Simulado")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: /06\s*Envolvente/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /06\s*Envolvente/ })).toHaveTextContent("3 de 5 cerradas · 1 abierta");
    expect(screen.getByRole("button", { name: /05\s*Cubierta/ })).toHaveAttribute("aria-expanded", "false");
    expect(lines()).toEqual(["06.01", "06.02", "06.05", "06.06", "06.09"]);

    const saving = row("Panel Thermochip de fachada");
    expect(within(saving).getByText("−450,00")).toHaveClass("text-good");
    expect(within(saving).getByText("−3,6 %")).toBeInTheDocument();
    expect(within(saving).getByRole("link", { name: "PED-041" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-41");
    expect(within(row("Lámina transpirable Tyvek")).getByText("+70,72")).toHaveClass("text-bad");

    // Two orders, the late one flagged.
    const stone = row("Aplacado de piedra natural");
    expect(within(stone).getByRole("link", { name: "PED-049" })).toBeInTheDocument();
    expect(within(stone).getByRole("link", { name: "PED-047" })).toBeInTheDocument();
    expect(within(stone).getByText("retraso")).toBeInTheDocument();

    // Open: what is contracted so far, never a deviation.
    const open = row("Estanqueidad al aire de la envolvente");
    expect(within(open).getByText("900,00")).toBeInTheDocument();
    expect(within(open).getByText("Abierta")).toBeInTheDocument();
    expect(within(open).getByText("sin desviación hasta cerrarla")).toBeInTheDocument();

    // Not contracted: no zero anywhere.
    const none = row("Perfilería de arranque y goterones");
    expect(within(none).getByText("Sin contratar")).toBeInTheDocument();
    expect(within(none).queryByText(/^[+−]?0,00/)).not.toBeInTheDocument();
  });

  it("warns about late deliveries, linking the order", () => {
    renderScreen();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("1 entrega con retraso: PED-049 Piedra de Liébana, capítulo 06, prevista el 14 oct.");
    expect(within(banner).getByRole("link", { name: "PED-049" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-49");
  });

  it("opens and closes a chapter", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /05\s*Cubierta/ }));
    expect(lines()).toContain("05.01");
    await userEvent.click(screen.getByRole("button", { name: /06\s*Envolvente/ }));
    expect(lines()).toEqual(["05.01"]);
  });

  it("filters by contracting and by text", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Con sobrecoste" }));
    expect(lines()).toEqual(["06.02", "06.05", "05.01"]);

    await userEvent.click(screen.getByRole("button", { name: "Abiertas" }));
    expect(lines()).toEqual(["06.09"]);

    await userEvent.click(screen.getByRole("button", { name: "Cerradas" }));
    expect(lines()).toEqual(["06.01", "06.02", "06.05", "05.01"]);

    await userEvent.click(screen.getByRole("button", { name: "Sin contratar" }));
    expect(lines()).toEqual(["06.06"]);

    await userEvent.click(screen.getByRole("button", { name: "Todas" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "teja");
    expect(lines()).toEqual(["05.01"]);

    await userEvent.clear(screen.getByRole("searchbox", { name: "Buscar partida" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "nada de esto");
    expect(screen.getByText("Ninguna partida coincide con los filtros.")).toBeInTheDocument();
  });
});
