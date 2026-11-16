// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { costs, header } from "../../../../../../test/construction-fixture";
import CostsScreen from "./CostsScreen";

// The app router's search params follow history.replaceState; jsdom's location stands in for them.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <CostsScreen projectId="p-1" header={header} costs={costs} budgetNumber={1} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

// The table (from 768px); the phone's cards are the list "Partidas", both in the DOM under CSS breakpoints.
const table = () => within(screen.getByRole("region", { name: "Partidas" }));
const cards = () => within(screen.getByRole("list", { name: "Partidas" }));
const lines = () =>
  table()
    .queryAllByRole("row")
    .map((row) => row.querySelector("td")?.textContent)
    .filter((code): code is string => !!code && /^\d+\.\d+$/.test(code));

const row = (text: string) => table().getByText(text).closest("tr")!;
const chapter = (name: RegExp) => table().getByRole("button", { name });
const card = (name: RegExp) => cards().getByRole("button", { name }).closest("li")!;
const params = () => Object.fromEntries(new URLSearchParams(window.location.search));
const goTo = (url: string) => window.history.replaceState(null, "", url);
afterEach(() => goTo("/"));

describe("CostsScreen", () => {
  it("folds every chapter into one row: its lines' totals and what needs a look", () => {
    renderScreen();

    const envelope = chapter(/06\s*Envolvente/);
    expect(envelope).toHaveAttribute("aria-expanded", "false");
    expect(chapter(/05\s*Cubierta/)).toHaveAttribute("aria-expanded", "false");
    expect(lines()).toEqual([]);
    expect(envelope).toHaveTextContent("5 partidas");
    expect(within(envelope).getByText("En curso")).toBeInTheDocument();
    expect(within(envelope).getByText("2 con sobrecoste")).toBeInTheDocument();
    expect(within(envelope).getByText("1 entrega con retraso")).toBeInTheDocument();
    const folded = envelope.closest("tr")!;
    expect(folded).toHaveTextContent("3 de 5 cerradas · 1 abierta");
    expect(within(folded).getByText("20.253,28")).toBeInTheDocument();
    expect(within(folded).getByText("17.810,00")).toBeInTheDocument();
    expect(within(folded).getByText("−183,28")).toHaveClass("text-good");
    expect(within(folded).getByText("−1,1 %")).toBeInTheDocument();
    expect(within(chapter(/05\s*Cubierta/)).queryByText("En curso")).not.toBeInTheDocument();

    const total = table().getByText("Total · 6 partidas").closest("tr")!;
    expect(within(total).getByText("40.253,28")).toBeInTheDocument();
    expect(within(total).getByText("38.810,00")).toBeInTheDocument();
    expect(within(total).getByText("+816,72")).toHaveClass("text-bad");
  });

  it("compares each line's cost with what Compras contracted", async () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Costes por partida" })).toBeInTheDocument();
    expect(screen.getByText("Presupuesto Rev.1")).toBeInTheDocument();
    expect(screen.getByText(/\(a coste y sin IVA, nunca precio de venta; sin el cap\. 20, la reserva de imprevistos\)/)).toBeInTheDocument();
    // Purchasing is real now: no "Simulado" anywhere.
    expect(screen.getByText("Real")).toBeInTheDocument();
    expect(screen.queryByText("Simulado")).not.toBeInTheDocument();

    await userEvent.click(chapter(/06\s*Envolvente/));
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
    expect(banner).toHaveTextContent("1 entrega con retraso: PED-049 Piedra de Liébana, capítulo 06, prevista el 14 oct 2026.");
    expect(within(banner).getByRole("link", { name: "PED-049" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-49");
  });

  it("opens and closes a chapter, or all of them, from the keyboard too, keeping it in the URL", async () => {
    renderScreen();
    const roof = chapter(/05\s*Cubierta/);
    roof.focus();
    await userEvent.keyboard("{Enter}");
    expect(roof).toHaveFocus();
    expect(roof).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(roof.getAttribute("aria-controls")!)).toContainElement(row("Teja cerámica mixta"));
    expect(lines()).toEqual(["05.01"]);
    expect(params()).toEqual({ abierto: "05" });

    await userEvent.click(chapter(/06\s*Envolvente/));
    expect(lines()).toEqual(["06.01", "06.02", "06.05", "06.06", "06.09", "05.01"]);
    expect(params()).toEqual({ abierto: "06,05" });
    await userEvent.click(roof);
    expect(lines()).toEqual(["06.01", "06.02", "06.05", "06.06", "06.09"]);

    await userEvent.click(screen.getByRole("button", { name: "Plegar todo" }));
    expect(lines()).toEqual([]);
    expect(params()).toEqual({});
    expect(screen.getByRole("button", { name: "Plegar todo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Desplegar todo" }));
    expect(lines()).toHaveLength(6);
    expect(params()).toEqual({ abierto: "06,05" });
  });

  it("shows the view the URL describes", () => {
    goTo("/dashboard/projects/p-1/obra/costes?estado=closed&abierto=05");
    renderScreen();
    expect(screen.getByRole("button", { name: /^Cerradas/ })).toHaveAttribute("aria-pressed", "true");
    // The filter would open both; the URL says only 05.
    expect(chapter(/06\s*Envolvente/)).toHaveAttribute("aria-expanded", "false");
    expect(lines()).toEqual(["05.01"]);
  });

  it("filters by contracting and by text, opening the chapters that match", async () => {
    renderScreen();

    // Counts for the whole obra.
    expect(screen.getByRole("group", { name: "Contratación" })).toHaveTextContent("Todas6Cerradas4Abiertas1Sin contratar1Con sobrecoste3");

    await userEvent.click(screen.getByRole("button", { name: /^Con sobrecoste/ }));
    expect(lines()).toEqual(["06.02", "06.05", "05.01"]);
    expect(params()).toEqual({ estado: "overrun" });
    // Folded totals follow what is shown.
    expect(within(chapter(/06\s*Envolvente/).closest("tr")!).getByText("+266,72")).toBeInTheDocument();
    expect(screen.queryByText(/^Total ·/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Abiertas/ }));
    expect(lines()).toEqual(["06.09"]);

    await userEvent.click(screen.getByRole("button", { name: /^Cerradas/ }));
    expect(lines()).toEqual(["06.01", "06.02", "06.05", "05.01"]);

    await userEvent.click(screen.getByRole("button", { name: /^Sin contratar/ }));
    expect(lines()).toEqual(["06.06"]);

    await userEvent.click(screen.getByRole("button", { name: /^Todas/ }));
    expect(lines()).toEqual([]);
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "teja");
    expect(lines()).toEqual(["05.01"]);
    expect(params()).toEqual({ q: "teja" });

    await userEvent.clear(screen.getByRole("searchbox", { name: "Buscar partida" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "nada de esto");
    expect(table().getByText("Ninguna partida coincide con los filtros.")).toBeInTheDocument();
  });

  it("on a phone, shows a card per chapter with its money on screen and its lines folded under it", async () => {
    renderScreen();

    const envelope = card(/06\s*Envolvente/);
    const toggle = within(envelope).getByRole("button", { name: /06\s*Envolvente/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("5 partidas");
    expect(within(toggle).getByText("2 con sobrecoste")).toBeInTheDocument();
    expect(within(envelope).getByText("Coste presup.")).toBeInTheDocument();
    expect(within(envelope).getByText("20.253,28")).toBeInTheDocument();
    expect(within(envelope).getByText("17.810,00")).toBeInTheDocument();
    expect(within(envelope).getByText("−183,28")).toHaveClass("text-good");
    expect(within(envelope).getByText("−1,1 %")).toBeInTheDocument();
    expect(envelope).toHaveTextContent("3 de 5 cerradas · 1 abierta");
    expect(within(envelope).queryByText("Panel Thermochip de fachada")).not.toBeInTheDocument();

    // The same fold as the table's: opening the card opens the chapter, in the URL too.
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(chapter(/06\s*Envolvente/)).toHaveAttribute("aria-expanded", "true");
    expect(params()).toEqual({ abierto: "06" });
    const panel = within(document.getElementById(toggle.getAttribute("aria-controls")!)!);
    const saving = panel.getByText("Panel Thermochip de fachada").closest("li")!;
    expect(within(saving).getByText("12.600,00")).toBeInTheDocument();
    expect(within(saving).getByText("−450,00")).toHaveClass("text-good");
    expect(within(saving).getByRole("link", { name: "PED-041" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-41");
    const open = panel.getByText("Estanqueidad al aire de la envolvente").closest("li")!;
    expect(within(open).getByText("sin desviación hasta cerrarla")).toBeInTheDocument();
    const none = panel.getByText("Perfilería de arranque y goterones").closest("li")!;
    expect(within(none).getByText("Sin contratar")).toBeInTheDocument();
    expect(within(none).queryByText(/^[+−]?0,00/)).not.toBeInTheDocument();

    // The obra's total under the cards.
    const total = screen.getAllByText("Total · 6 partidas").find((el) => !el.closest("tr"))!.parentElement!;
    expect(within(total).getByText("40.253,28")).toBeInTheDocument();
    expect(within(total).getByText("38.810,00")).toBeInTheDocument();
    expect(within(total).getByText("+816,72")).toHaveClass("text-bad");
  });

  it("on a phone, filters by contracting with a select", async () => {
    renderScreen();
    const select = screen.getByRole("combobox", { name: "Contratación" });
    expect(within(select).getByRole("option", { name: "Con sobrecoste · 3" })).toBeInTheDocument();
    await userEvent.selectOptions(select, "overrun");
    expect(params()).toEqual({ estado: "overrun" });
    expect(screen.getByRole("button", { name: /^Con sobrecoste/ })).toHaveAttribute("aria-pressed", "true");
    expect(cards().getAllByRole("button").map((b) => b.getAttribute("aria-controls"))).toEqual(["costs-card-06", "costs-card-05"]);
  });
});
