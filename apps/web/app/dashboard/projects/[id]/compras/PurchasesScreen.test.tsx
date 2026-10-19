// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/es.json";
import { header } from "../../../../../test/construction-fixture";
import { projectPurchases } from "../../../../../test/purchasing-fixture";
import PurchasesScreen from "./PurchasesScreen";

const chapters = [
  { code: "05", name: "Cubierta" },
  { code: "06", name: "Envolvente" },
  { code: "13", name: "Electricidad" },
];

function renderScreen(props: Partial<Parameters<typeof PurchasesScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PurchasesScreen projectId="p-1" header={header} chapters={chapters} purchases={projectPurchases} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

/** The order numbers in the table, top to bottom. */
const numbers = () =>
  within(screen.getByRole("table", { name: "Pedidos" }))
    .queryAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => text?.startsWith("PED-"));

describe("PurchasesScreen", () => {
  it("shows what is contracted, the deviation over closed lines, what is left and what is late", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Compras" })).toBeInTheDocument();
    expect(screen.getByText("Etapa 6 · Ejecución de obra")).toBeInTheDocument();
    const kpis = within(screen.getByRole("region", { name: "Resumen de compras" }));
    expect(kpis.getByText("214.270 €")).toBeInTheDocument();
    expect(kpis.getByText(/de 312.840 € a coste/)).toBeInTheDocument();
    expect(kpis.getByText("+3412 €")).toHaveClass("text-good");
    expect(kpis.getByText(/Ahorro del 1,9 % sobre 58 partidas cerradas/)).toBeInTheDocument();
    expect(kpis.getByText("98.170 €")).toBeInTheDocument();
    expect(kpis.getByText("44 partidas sin pedido · 1 pedido pendiente de enviar")).toBeInTheDocument();
    expect(kpis.getByRole("link", { name: "PED-049" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-49");
    expect(kpis.getByText(/Piedra de Liébana · prevista 14 oct, 3 días/)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Nuevo pedido" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/nuevo");
  });

  it("lists every order with its supplier, late deliveries and CAE warnings", () => {
    renderScreen();

    expect(numbers()).toEqual(["PED-056", "PED-049", "PED-047", "PED-040", "PED-038"]);
    const table = within(screen.getByRole("table", { name: "Pedidos" }));
    const late = table.getByRole("link", { name: "PED-049" }).closest("tr")!;
    expect(within(late).getByText("3 d tarde")).toBeInTheDocument();
    expect(within(late).getByText("14 oct")).toBeInTheDocument();
    expect(within(late).getByText("En tránsito")).toBeInTheDocument();
    expect(within(late).getByText("3120,00")).toBeInTheDocument();
    const revocos = table.getByRole("link", { name: "PED-047" }).closest("tr")!;
    expect(within(revocos).getByText("CAE pendiente")).toBeInTheDocument();
    expect(within(revocos).getByText("20 oct – 7 nov")).toBeInTheDocument();
    // Phones get cards with the same orders.
    expect(within(screen.getByRole("list", { name: "Pedidos" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("filters by state, supplier, chapter and lateness", async () => {
    renderScreen();

    const states = within(screen.getByRole("group", { name: "Estado" }));
    expect(states.getByRole("button", { name: /Abiertos\s*2/ })).toBeInTheDocument();
    await userEvent.click(states.getByRole("button", { name: /Abiertos/ }));
    expect(numbers()).toEqual(["PED-049", "PED-047"]);
    await userEvent.click(states.getByRole("button", { name: /Sin enviar/ }));
    expect(numbers()).toEqual(["PED-056"]);
    await userEvent.click(states.getByRole("button", { name: /Cerrados/ }));
    expect(numbers()).toEqual(["PED-040"]);
    await userEvent.click(states.getByRole("button", { name: /Todos/ }));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "Revocos Cantábrico");
    expect(numbers()).toEqual(["PED-047"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "Todos");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Capítulo" }), "05 Cubierta");
    expect(numbers()).toEqual(["PED-040"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Capítulo" }), "Todos");

    await userEvent.click(screen.getByRole("checkbox", { name: "Solo con retraso" }));
    expect(numbers()).toEqual(["PED-049"]);
    await userEvent.click(states.getByRole("button", { name: /Sin enviar/ }));
    expect(screen.getAllByText("Ningún pedido con estos filtros.").length).toBeGreaterThan(0);
  });

  it("shows the chapters to contract soon by their order-by dates, with simulated dates", () => {
    renderScreen();

    const soon = within(screen.getByRole("region", { name: "Por contratar pronto" }));
    expect(soon.getByText("Simulado")).toBeInTheDocument();
    expect(soon.getByRole("link", { name: "Climatización" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/nuevo?capitulo=12");
    expect(soon.getByRole("link", { name: "PED-055" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-55");
    expect(soon.getByText(/Inicio 2 nov · pedir antes del 19 oct · 4 partidas/)).toBeInTheDocument();
    // Climatización's orders should have gone out on 21 September.
    expect(soon.getByText("pedir ya: 26 días tarde")).toBeInTheDocument();
    expect(soon.getByText("23.410 €")).toBeInTheDocument();
  });

  it("hides every way to order from viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("link", { name: "Nuevo pedido" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pedir partidas de un capítulo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Climatización" })).not.toBeInTheDocument();
  });

  it("says so when the obra has no orders", () => {
    renderScreen({ purchases: { ...projectPurchases, orders: [] } });
    expect(screen.getByText("Todavía no hay pedidos en esta obra.")).toBeInTheDocument();
  });
});
