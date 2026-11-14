// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import { invoices } from "../../../../test/invoice-fixture";
import { parseInvoicesQuery } from "../list-query";
import InvoicesScreen from "./InvoicesScreen";

// The list's filters live in the URL: the screen replaces it and the server renders the page again.
const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/dashboard/compras/facturas",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

function renderScreen({ canManage = true, search = "", list = invoices } = {}) {
  navigation.search = search;
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <InvoicesScreen invoices={list} canManage={canManage} query={parseInvoicesQuery(Object.fromEntries(new URLSearchParams(search)))} />
    </NextIntlClientProvider>,
  );
}

const numbers = () =>
  within(screen.getByRole("region", { name: "Facturas recibidas" }))
    .queryAllByRole("link")
    .map((link) => link.textContent)
    .filter((text) => /^[A-Z]{3}-/.test(text ?? ""));
const replaced = () => navigation.replace.mock.lastCall?.[0];

beforeEach(() => navigation.replace.mockReset());

describe("InvoicesScreen", () => {
  it("shows what is owed, past due and due soon, and the page of invoices, owed first", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Facturas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar factura" })).toHaveAttribute("href", "/dashboard/compras/facturas/nueva");
    const kpis = within(screen.getByRole("region", { name: "Resumen de facturas" }));
    expect(kpis.getByText("17.348 €")).toBeInTheDocument();
    expect(kpis.getByText("2 facturas de 2 proveedores")).toBeInTheDocument();
    expect(kpis.getByText("3848 €")).toHaveClass("text-bad");

    expect(numbers()).toEqual(["SOC-2026/0912", "MSN-2026/148", "MSN-2026/112", "MSN-2026/R07"]);
    const overdue = screen.getByRole("link", { name: "SOC-2026/0912" }).closest("tr")!;
    expect(within(overdue).getByText("hace 4 días")).toHaveClass("text-bad");
    expect(within(overdue).getByText("Vencida")).toBeInTheDocument();
    const partial = screen.getByRole("link", { name: "MSN-2026/148" }).closest("tr")!;
    expect(within(partial).getByText("en 3 días")).toBeInTheDocument();
    expect(within(partial).getByRole("link", { name: /PED-004 · Entrega en obra/ })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-4");
    const credit = screen.getByRole("link", { name: "MSN-2026/R07" }).closest("tr")!;
    expect(within(credit).getByText("rectifica MSN-2026/112")).toBeInTheDocument();
    // One page holds them all: no pager.
    expect(screen.queryByRole("navigation", { name: "Páginas" })).not.toBeInTheDocument();
  });

  it("shows the filters of the URL, with the counts the server gives each state", () => {
    renderScreen({ search: "estado=overdue&proveedor=sup-soc&q=PED-003" });

    expect(screen.getByRole("button", { name: /Vencidas/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Vencidas/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Todas/ })).toHaveTextContent("4");
    expect(screen.getByRole("combobox", { name: "Proveedor" })).toHaveValue("sup-soc");
    expect(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" })).toHaveValue("PED-003");
  });

  it("puts each filter in the URL, back on the first page", async () => {
    renderScreen({ search: "page=4" });

    await userEvent.click(screen.getByRole("button", { name: /Vencidas/ }));
    expect(replaced()).toBe("/dashboard/compras/facturas?estado=overdue");
    await userEvent.click(screen.getByRole("button", { name: /Abonos/ }));
    expect(replaced()).toBe("/dashboard/compras/facturas?estado=credit");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Proveedor" }), "sup-soc");
    expect(replaced()).toBe("/dashboard/compras/facturas?proveedor=sup-soc");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Obra" }), "p-2");
    expect(replaced()).toBe("/dashboard/compras/facturas?obra=p-2");
    navigation.replace.mockClear();
    await userEvent.type(screen.getByRole("searchbox", { name: "Nº, proveedor o concepto" }), "PED-004");
    await waitFor(() => expect(replaced()).toBe("/dashboard/compras/facturas?q=PED-004"));
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it("pages through the invoices the filters keep", () => {
    renderScreen({ search: "estado=paid&page=2", list: { ...invoices, paging: { page: 2, limit: 50, total: 1204, pages: 25 } } });

    const pager = within(screen.getByRole("navigation", { name: "Páginas" }));
    expect(pager.getByText("51–100 de 1204")).toBeInTheDocument();
    expect(pager.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", "/dashboard/compras/facturas?estado=paid");
    expect(pager.getByRole("link", { name: "Siguiente" })).toHaveAttribute("href", "/dashboard/compras/facturas?estado=paid&page=3");
  });

  it("says so when no invoice matches the filters", () => {
    renderScreen({ search: "q=x", list: { ...invoices, invoices: [], paging: { page: 1, limit: 50, total: 0, pages: 1 } } });
    expect(screen.getByText("Ninguna factura con estos filtros.")).toBeInTheDocument();
  });

  it("offers no registering to viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("link", { name: "Registrar factura" })).not.toBeInTheDocument();
  });
});
