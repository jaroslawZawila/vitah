// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import { tenantPurchases } from "../../../test/purchasing-fixture";
import ComprasScreen from "./ComprasScreen";
import { parseOrdersQuery } from "./list-query";

// The list's filters live in the URL: the screen replaces it and the server renders the page again.
const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/dashboard/compras",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("../../actions/purchasing", () => ({ exportPurchases: vi.fn() }));
const actions = await import("../../actions/purchasing");

function renderScreen(purchases = tenantPurchases, search = "") {
  navigation.search = search;
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ComprasScreen purchases={purchases} query={parseOrdersQuery(Object.fromEntries(new URLSearchParams(search)))} />
    </NextIntlClientProvider>,
  );
}

const numbers = () =>
  within(screen.getByRole("table", { name: "Pedidos" }))
    .queryAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => text?.startsWith("PED-"));
const replaced = () => navigation.replace.mock.lastCall?.[0];

beforeEach(() => {
  navigation.replace.mockReset();
  vi.mocked(actions.exportPurchases).mockReset().mockResolvedValue([]);
});

describe("ComprasScreen", () => {
  it("shows the page of orders, with the company's totals", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Pedidos" })).toBeInTheDocument();
    const kpis = within(screen.getByRole("region", { name: "Resumen" }));
    expect(kpis.getByText("Contratado en 2026")).toBeInTheDocument();
    expect(kpis.getByText("486.910 €")).toBeInTheDocument();
    expect(kpis.getByText("41 pedidos en 3 obras")).toBeInTheDocument();
    expect(kpis.getByText("9 pedidos por entregar o terminar")).toBeInTheDocument();
    expect(kpis.getByText("4 pedidos pendientes")).toBeInTheDocument();
    expect(kpis.getByText("En VTH-26-001, VTH-26-003")).toBeInTheDocument();

    expect(numbers()).toEqual(["PED-056", "PED-049", "PED-047", "PED-040", "PED-038", "PED-014"]);
    const table = within(screen.getByRole("table", { name: "Pedidos" }));
    const row = table.getByRole("link", { name: "PED-014" }).closest("tr")!;
    expect(within(row).getByRole("link", { name: "VTH-26-003" })).toHaveAttribute("href", "/dashboard/projects/p-3/compras");
    expect(within(row).getByRole("link", { name: "PED-014" })).toHaveAttribute("href", "/dashboard/projects/p-3/compras/order-14");
    expect(within(row).getByText("7 d tarde")).toBeInTheDocument();
    expect(within(row).getByText("30 sept")).toBeInTheDocument();
    // One page holds them all: no pager.
    expect(screen.queryByRole("navigation", { name: "Páginas" })).not.toBeInTheDocument();
  });

  it("totals every order the filters keep, not only the page shown, and pages through them", () => {
    renderScreen(
      { ...tenantPurchases, paging: { page: 2, limit: 50, total: 141, pages: 3 }, shownContractedCents: 123_456_700 },
      "estado=open&page=2",
    );

    const table = within(screen.getByRole("table", { name: "Pedidos" }));
    expect(table.getByText("141 pedidos · contratado").closest("tr")).toHaveTextContent("1.234.567,00");
    const pager = within(screen.getByRole("navigation", { name: "Páginas" }));
    expect(pager.getByText("51–100 de 141")).toBeInTheDocument();
    expect(pager.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/dashboard/compras?estado=open");
    expect(pager.getByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/dashboard/compras?estado=open&page=3");
  });

  it("has no next page on the last one, and a way back from a page past the end", () => {
    const { unmount } = renderScreen({ ...tenantPurchases, paging: { page: 3, limit: 50, total: 141, pages: 3 } }, "page=3");
    let pager = within(screen.getByRole("navigation", { name: "Páginas" }));
    expect(pager.getByText("101–141 de 141")).toBeInTheDocument();
    expect(pager.queryByRole("link", { name: "Siguiente" })).not.toBeInTheDocument();
    unmount();

    renderScreen({ ...tenantPurchases, orders: [], paging: { page: 9, limit: 50, total: 141, pages: 3 } }, "page=9");
    pager = within(screen.getByRole("navigation", { name: "Páginas" }));
    expect(pager.getByText("Ninguno en esta página · 141 en total")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/dashboard/compras?page=3");
  });

  it("shows the filters of the URL, with the counts the server gives each state", () => {
    renderScreen(tenantPurchases, "estado=open&obra=p-3&tipo=subcontract&desde=2026-10-01&retraso=1&q=ventanas");

    const states = within(screen.getByRole("group", { name: "Estado" }));
    expect(states.getByRole("button", { name: /Abiertos/ })).toHaveAttribute("aria-pressed", "true");
    expect(states.getByRole("button", { name: /Abiertos/ })).toHaveTextContent("3");
    expect(states.getByRole("button", { name: /Todos/ })).toHaveTextContent("6");
    expect(screen.getByRole("combobox", { name: "Obra" })).toHaveValue("p-3");
    expect(screen.getByRole("combobox", { name: "Tipo" })).toHaveValue("subcontract");
    expect(within(screen.getByRole("group", { name: "Fecha de pedido" })).getByLabelText("Desde")).toHaveValue("2026-10-01");
    expect(screen.getByRole("checkbox", { name: "Solo con retraso" })).toBeChecked();
    expect(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" })).toHaveValue("ventanas");
  });

  it("puts each filter in the URL, back on the first page", async () => {
    renderScreen(tenantPurchases, "page=3");

    await userEvent.click(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: /Cancelados/ }));
    expect(replaced()).toBe("/dashboard/compras?estado=cancelled");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Obra" }), "VTH-26-003 Suances");
    expect(replaced()).toBe("/dashboard/compras?obra=p-3");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "Piedra de Liébana");
    expect(replaced()).toBe("/dashboard/compras?proveedor=sup-liebana");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "Subcontrato");
    expect(replaced()).toBe("/dashboard/compras?tipo=subcontract");
    await userEvent.type(within(screen.getByRole("group", { name: "Fecha de pedido" })).getByLabelText("Desde"), "2026-10-01");
    expect(replaced()).toBe("/dashboard/compras?desde=2026-10-01");
    await userEvent.click(screen.getByRole("checkbox", { name: "Solo con retraso" }));
    expect(replaced()).toBe("/dashboard/compras?retraso=1");
    await userEvent.click(screen.getByRole("button", { name: "Por proveedor" }));
    expect(replaced()).toBe("/dashboard/compras?vista=proveedores");
  });

  it("searches once typing stops, keeping the other filters", async () => {
    renderScreen(tenantPurchases, "estado=open&page=2");
    navigation.replace.mockClear();

    await userEvent.type(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" }), "ventanas");
    expect(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" })).toHaveValue("ventanas");
    await waitFor(() => expect(replaced()).toBe("/dashboard/compras?estado=open&q=ventanas"));
    // One search for the word, not one per letter.
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it("shows the orders by supplier as the server groups them", () => {
    renderScreen(
      {
        ...tenantPurchases,
        orders: [],
        bySupplier: [
          { id: "sup-besaya", name: "Cubiertas Besaya", suppliesOnly: false, orders: 1, projectRefs: ["VTH-26-001"], contractedCents: 1_986_000, openCents: 0 },
          { id: "sup-liebana", name: "Piedra de Liébana", suppliesOnly: true, orders: 1, projectRefs: ["VTH-26-001"], contractedCents: 312_000, openCents: 312_000 },
        ],
      },
      "vista=proveedores",
    );

    const table = within(screen.getByRole("table", { name: "Pedidos por proveedor" }));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Cubiertas Besaya");
    const stone = table.getByRole("link", { name: "Piedra de Liébana" });
    expect(stone).toHaveAttribute("href", "/dashboard/subcontratas/empresas/sup-liebana");
    expect(stone.closest("tr")).toHaveTextContent("Proveedor de material");
    expect(screen.queryByRole("navigation", { name: "Páginas" })).not.toBeInTheDocument();
  });

  describe("CSV", () => {
    let blobs: Blob[];
    beforeEach(() => {
      blobs = [];
      URL.createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:compras";
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it("exports every order the filters keep, asked of the server", async () => {
      const late = tenantPurchases.orders.filter((o) => o.lateDays !== null);
      vi.mocked(actions.exportPurchases).mockResolvedValue(late);
      // The page shown holds none of them: the export doesn't come from it.
      renderScreen({ ...tenantPurchases, orders: [], paging: { page: 2, limit: 50, total: 2, pages: 1 } }, "retraso=1&page=2");
      await act(() => userEvent.click(screen.getByRole("button", { name: "Exportar CSV" })));

      expect(actions.exportPurchases).toHaveBeenCalledWith({
        group: "all",
        projectId: "",
        supplierId: "",
        kind: "all",
        from: "",
        to: "",
        late: "1",
        q: "",
      });
      await waitFor(() => expect(blobs).toHaveLength(1));
      const text = await blobs[0]!.text();
      const rows = text.replace(/^\uFEFF/, "").split("\r\n");
      expect(rows[0]).toBe(
        "Obra;Nº;Tipo;Proveedor;Concepto;Capítulos;Importe (€, sin IVA);Fecha de pedido;Entrega / trabajos;Entregado / finalizado;Estado;Días de retraso",
      );
      expect(rows.slice(1)).toEqual([
        "VTH-26-001;PED-049;Material;Piedra de Liébana;Mampostería de piedra natural, 24 m²;06;3120,00;2026-10-03;2026-10-14;;En tránsito;3",
        "VTH-26-003;PED-014;Material;Carpinterías Cabezón;Ventanas de aluminio RPT (11 ud);10;19480,00;2026-09-30;2026-10-10;;Confirmado;7",
      ]);
    });
  });

  it("says so when there are no orders, or none with the filters", () => {
    const none = { ...tenantPurchases, orders: [], paging: { page: 1, limit: 50, total: 0, pages: 1 }, groupCounts: { all: 0, open: 0, pending: 0, done: 0, cancelled: 0 } };
    const { unmount } = renderScreen(none);
    expect(screen.getAllByText("Todavía no hay pedidos.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
    unmount();

    renderScreen(none, "q=nada");
    expect(screen.getAllByText("Ningún pedido con estos filtros.").length).toBeGreaterThan(0);
  });
});
