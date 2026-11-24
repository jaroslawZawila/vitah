// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { lines } from "../../../../../test/invoice-fixture";
import PurchaseLinesScreen from "./PurchaseLinesScreen";

// The app router's search params follow history.replaceState; jsdom's location stands in for them.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PurchaseLinesScreen projectId="p-1" header={{ ref: "VTH-26-001", stage: 4, openIssues: 0 }} lines={lines} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

const goTo = (url: string) => window.history.replaceState(null, "", url);
afterEach(() => goTo("/"));

const table = () => within(screen.getByRole("region", { name: "Partidas del presupuesto" }));
const row = (code: string) => table().getByText(code).closest("tr")!;
/** A chapter's toggle by its code ("03", not a line's "03.01"). */
const chapterName = (code: string) => new RegExp(`^${code}(?!\\.)`);
const chapter = (code: string) => table().getByRole("button", { name: chapterName(code) });
const params = () => Object.fromEntries(new URLSearchParams(window.location.search));

describe("PurchaseLinesScreen", () => {
  it("shows the obra's figures, its invoices due and each chapter folded with its lines' totals", () => {
    renderScreen();

    const views = within(screen.getByRole("navigation", { name: "Vista" }));
    expect(views.getByRole("link", { name: "Partidas" })).toHaveAttribute("aria-current", "page");
    expect(views.getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras?vista=pedidos");

    const kpis = within(screen.getByRole("region", { name: "Resumen de compras" }));
    // Money by budget line is without VAT, as compared with the cost.
    expect(kpis.getByText("Contratado · sin IVA")).toBeInTheDocument();
    expect(kpis.getByText("Desviación · sin IVA")).toBeInTheDocument();
    expect(kpis.getByText("Facturado · sin IVA")).toBeInTheDocument();
    expect(kpis.getByText("Pagado · sin IVA")).toBeInTheDocument();
    expect(kpis.getByText("61.980,00 €")).toBeInTheDocument();
    expect(kpis.getByText("1 abono")).toBeInTheDocument();
    expect(kpis.getByText("Vencido 3.180,00 €")).toHaveClass("text-bad");

    const due = screen.getByRole("status");
    expect(due).toHaveTextContent("2 facturas vencidas o que vencen en los próximos 7 días.");
    expect(within(due).getByRole("link", { name: /SOC-2026\/0912/ })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-912");
    expect(due).toHaveTextContent("venció el 15 oct 2026");
    expect(within(due).getByRole("link", { name: "Ver vencimientos" })).toHaveAttribute("href", "/dashboard/compras/facturas");

    // Every chapter folded: no line shows.
    for (const name of ["02", "03", "10"]) expect(chapter(name)).toHaveAttribute("aria-expanded", "false");
    expect(table().queryByText("03.01")).not.toBeInTheDocument();

    const structure = chapter("03").closest("tr")!;
    expect(structure).toHaveTextContent("1 partida");
    expect(within(structure).getByText("80.000,00")).toBeInTheDocument();
    expect(within(structure).getByText("87.000,00")).toBeInTheDocument();
    expect(within(structure).getByText("+7.000,00")).toHaveClass("text-bad");
    expect(within(structure).getByText("58.800,00")).toBeInTheDocument();
    expect(within(structure).getByText("42.360,00")).toBeInTheDocument();
    expect(within(structure).getByText("1 con factura")).toBeInTheDocument();
    // On a phone the headings are hidden and each chapter is a card: each figure says what it is.
    for (const label of ["Coste presup.", "Contratado", "Desviación", "Facturado", "Pagado"]) {
      expect(within(structure).getByText(label)).toBeInTheDocument();
    }
    // What needs a look, while folded.
    expect(within(chapter("02")).getByText("1 con factura vencida")).toBeInTheDocument();
    expect(within(chapter("10")).queryByText(/Pedir antes del/)).not.toBeInTheDocument();
    expect(within(chapter("10").closest("tr")!).getByText("1 por contratar")).toBeInTheDocument();

    const total = table().getByText("Total · 3 partidas").closest("tr")!;
    expect(within(total).getByText("61.980,00")).toBeInTheDocument();
    expect(within(total).getByText("42.360,00")).toBeInTheDocument();
  });

  it("folds a chapter open on its lines and a line on its orders, milestones and invoices, keeping focus", async () => {
    renderScreen();

    const toggle = chapter("03");
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(row("03.01"));
    expect(within(row("03.01")).getByText("Factura")).toBeInTheDocument();
    expect(params()).toEqual({ abierto: "03" });

    const line = within(row("03.01")).getByRole("button", { expanded: false });
    await userEvent.click(line);
    expect(line).toHaveAttribute("aria-expanded", "true");
    expect(table().getByRole("link", { name: "PED-004" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    expect(table().getByText("Fin de montaje")).toBeInTheDocument();
    expect(table().getByRole("link", { name: "MSN-2026/148" })).toHaveAttribute("href", "/dashboard/compras/facturas/inv-148");
    expect(table().getByText("Pagados 15.000,00 · quedan 13.500,00")).toBeInTheDocument();
    expect(table().getByText("Por facturar", { selector: "span.text-muted-foreground" })).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(table().queryByText("03.01")).not.toBeInTheDocument();
    expect(params()).toEqual({});

    await userEvent.click(screen.getByRole("button", { name: "Desplegar todo" }));
    expect(params()).toEqual({ abierto: "02,03,10" });
    expect(row("02.02")).toBeInTheDocument();
    expect(row("10.01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desplegar todo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Plegar todo" }));
    expect(params()).toEqual({});
    expect(table().queryByText("02.02")).not.toBeInTheDocument();
  });

  it("filters by state and by text, opening the chapters that match", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: /Pendiente de contratar/ }));
    expect(params()).toEqual({ estado: "to_contract" });
    expect(table().queryByRole("button", { name: chapterName("03") })).not.toBeInTheDocument();
    expect(chapter("10")).toHaveAttribute("aria-expanded", "true");
    // The obra's totals don't add up the rows shown: hidden while filtered.
    expect(table().queryByText(/^Total ·/)).not.toBeInTheDocument();
    await userEvent.click(within(row("10.01")).getByRole("button", { expanded: false }));
    expect(table().getByText(/^Sin pedidos\./)).not.toHaveTextContent(/pedirse/);
    expect(table().getByRole("link", { name: "Crear pedido" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/nuevo?capitulo=10");

    await userEvent.click(screen.getByRole("button", { name: /^Todas/ }));
    expect(chapter("10")).toHaveAttribute("aria-expanded", "false");
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "antirradón");
    expect(params()).toEqual({ q: "antirradón" });
    expect(chapter("02")).toHaveAttribute("aria-expanded", "true");
    expect(row("02.02")).toBeInTheDocument();
    expect(table().queryByRole("button", { name: chapterName("03") })).not.toBeInTheDocument();

    // A chapter shut by hand while searching stays shut, and says so in the URL.
    await userEvent.click(chapter("02"));
    expect(params()).toEqual({ q: "antirradón", abierto: "" });

    await userEvent.clear(screen.getByRole("searchbox", { name: "Buscar partida" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "nada de esto");
    expect(table().getByText("Ninguna partida con estos filtros.")).toBeInTheDocument();
  });

  it("shows the view the URL describes, so a link or a reload finds it as it was", async () => {
    goTo("/dashboard/projects/p-1/compras?estado=invoiced&abierto=03");
    const { unmount } = renderScreen();
    expect(screen.getByRole("button", { name: /^Factura/ })).toHaveAttribute("aria-pressed", "true");
    expect(chapter("03")).toHaveAttribute("aria-expanded", "true");
    expect(chapter("02")).toHaveAttribute("aria-expanded", "false");
    expect(table().queryByRole("button", { name: chapterName("10") })).not.toBeInTheDocument();

    await userEvent.click(chapter("02"));
    // Both open is what the filter opens anyway: the URL says no more than the filter.
    expect(window.location.search).toBe("?estado=invoiced");
    unmount();

    renderScreen();
    expect(chapter("02")).toHaveAttribute("aria-expanded", "true");
    expect(chapter("03")).toHaveAttribute("aria-expanded", "true");
  });

  it("offers no new order to viewers", async () => {
    renderScreen(false);
    expect(screen.queryByRole("link", { name: "Nuevo pedido" })).not.toBeInTheDocument();
    await userEvent.click(chapter("10"));
    await userEvent.click(within(row("10.01")).getByRole("button", { expanded: false }));
    expect(table().queryByRole("link", { name: "Crear pedido" })).not.toBeInTheDocument();
  });
});
