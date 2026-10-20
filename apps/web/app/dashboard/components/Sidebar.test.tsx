// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import type { PurchasingCounts, SubcontractorCounts } from "@repo/core/contract";
import Sidebar from "./Sidebar";

const navigation = { pathname: "/dashboard/projects", params: {} as { id?: string } };
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useParams: () => navigation.params,
}));
const onLanguageChange = vi.fn(async () => ({}));

/** Next only sets `id` on `projects/[id]` routes. */
function renderAt(
  pathname: string,
  isAdmin = true,
  subcontractors: SubcontractorCounts | null = null,
  purchases: PurchasingCounts | null = null,
) {
  navigation.pathname = pathname;
  navigation.params = /^\/dashboard\/projects\/(?!new$)[^/]+/.test(pathname)
    ? { id: pathname.split("/")[3] }
    : {};
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <Sidebar
        name="Laura"
        email="laura@vitah.es"
        isAdmin={isAdmin}
        subcontractors={subcontractors}
        purchases={purchases}
        language="es"
        onLanguageChange={onLanguageChange}
      />
    </NextIntlClientProvider>,
  );
}

const projectTabs = () => screen.queryByRole("list", { name: "Secciones del proyecto" });

describe("Sidebar", () => {
  it("shows the main sections, admin ones only to admins", () => {
    renderAt("/dashboard/projects", false);

    expect(screen.getByRole("link", { name: /Proyectos/ })).toHaveAttribute(
      "href",
      "/dashboard/projects",
    );
    expect(screen.queryByRole("link", { name: /Clientes/ })).not.toBeInTheDocument();
  });

  it("has no project tabs outside a project", () => {
    renderAt("/dashboard/projects");
    expect(projectTabs()).not.toBeInTheDocument();
  });

  it("has no project tabs on the new-project wizard", () => {
    renderAt("/dashboard/projects/new");
    expect(projectTabs()).not.toBeInTheDocument();
  });

  it.each([
    ["/dashboard/projects/p-1", "General"],
    ["/dashboard/projects/p-1/obra", "Obra"],
    ["/dashboard/projects/p-1/obra/avance/05", "Obra"],
    ["/dashboard/projects/p-1/obra/fotos", "Obra"],
    ["/dashboard/projects/p-1/budget", "Presupuesto"],
    ["/dashboard/projects/p-1/compras", "Compras"],
    ["/dashboard/projects/p-1/compras/o-1/editar", "Compras"],
    ["/dashboard/projects/p-1/payments", "Pagos"],
    ["/dashboard/projects/p-1/payments/h-4", "Pagos"],
    ["/dashboard/projects/p-1/documents", "Documentos"],
  ])("opens the project's tabs on %s", (pathname, current) => {
    renderAt(pathname);

    const tabs = within(projectTabs()!);
    expect(tabs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["General", "/dashboard/projects/p-1"],
      ["Obra", "/dashboard/projects/p-1/obra"],
      ["Presupuesto", "/dashboard/projects/p-1/budget"],
      ["Compras", "/dashboard/projects/p-1/compras"],
      ["Pagos", "/dashboard/projects/p-1/payments"],
      ["Documentos", "/dashboard/projects/p-1/documents"],
    ]);
    expect(tabs.getByRole("link", { current: "page" })).toHaveTextContent(current);
  });

  it("has the company-wide Compras in the Red group for every staff member", () => {
    renderAt("/dashboard/projects", false);
    const link = screen.getByRole("link", { name: "Compras" });
    expect(link).toHaveAttribute("href", "/dashboard/compras");
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("opens Compras on Pedidos, with Solicitudes (those to approve), Facturas and Pagos and their counts", () => {
    renderAt("/dashboard/compras", true, null, { requests: 2, orders: 58, invoices: 9, payments: 4, dueAttention: 3 });
    const sections = within(screen.getByRole("list", { name: "Secciones de compras" }));
    expect(sections.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Solicitudes2", "/dashboard/compras/solicitudes"],
      ["Pedidos58", "/dashboard/compras"],
      ["Facturas9", "/dashboard/compras/facturas"],
      ["Pagos4", "/dashboard/compras/pagos"],
    ]);
    expect(sections.getByRole("link", { name: /Pedidos/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^Compras/ })).toHaveTextContent("3 · 3 facturas vencidas o por vencer");
  });

  it("marks the Compras section open, on an invoice too", () => {
    renderAt("/dashboard/compras/facturas/inv-1", true, null, { requests: 0, orders: 1, invoices: 1, payments: 0, dueAttention: 0 });
    const sections = within(screen.getByRole("list", { name: "Secciones de compras" }));
    expect(sections.getByRole("link", { name: /Facturas/ })).toHaveAttribute("aria-current", "page");
    expect(sections.getByRole("link", { name: /Pedidos/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Compras" })).toBeInTheDocument();
  });

  it("marks Solicitudes current on its page, not Pedidos", () => {
    renderAt("/dashboard/compras/solicitudes", true, null, { requests: 1, orders: 1, invoices: 0, payments: 0, dueAttention: 0 });
    const sections = within(screen.getByRole("list", { name: "Secciones de compras" }));
    expect(sections.getByRole("link", { name: /Solicitudes/ })).toHaveAttribute("aria-current", "page");
    expect(sections.getByRole("link", { name: /Pedidos/ })).not.toHaveAttribute("aria-current");
  });

  describe("Subcontratas", () => {
    const counts = { companies: 8, workers: 31, expiries: 5 };
    const sections = () => screen.queryByRole("list", { name: "Secciones de subcontratas" });

    it("is in the Red group for every staff member, collapsed elsewhere with its expiries", () => {
      renderAt("/dashboard/projects", false, counts);

      expect(screen.getByText("Red")).toBeInTheDocument();
      const link = screen.getByRole("link", { name: /Subcontratas/ });
      expect(link).toHaveAttribute("href", "/dashboard/subcontratas/empresas");
      expect(link).toHaveTextContent("5");
      expect(sections()).not.toBeInTheDocument();
    });

    it("opens its pages with their badges inside the section", () => {
      renderAt("/dashboard/subcontratas/trabajadores/w-1", true, counts);

      const links = within(sections()!).getAllByRole("link");
      expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
        ["Empresas8", "/dashboard/subcontratas/empresas"],
        ["Trabajadores31", "/dashboard/subcontratas/trabajadores"],
        ["Caducidades5 · 5 documentos caducados o por caducar", "/dashboard/subcontratas/empresas#caducidades"],
      ]);
      expect(within(sections()!).getByRole("link", { current: "page" })).toHaveTextContent("Trabajadores");
    });

    it("hides the expiries badge when nothing expires", () => {
      renderAt("/dashboard/subcontratas/empresas", true, { ...counts, expiries: 0 });
      expect(within(sections()!).getByRole("link", { name: "Caducidades" })).toBeInTheDocument();
    });
  });

  it("switches the portal's language from the settings menu", async () => {
    onLanguageChange.mockClear();
    renderAt("/dashboard/projects");
    // One menu at the foot of the rail (desktop), one in the top bar (phones).
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
    const [settings] = screen.getAllByRole("button", { name: /Ajustes/ });
    fireEvent.click(settings!);

    const spanish = await screen.findByRole("menuitemradio", { name: "Español" });
    expect(spanish).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Inglés" })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(spanish);
    expect(onLanguageChange).not.toHaveBeenCalled();
    fireEvent.click(settings!);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Inglés" }));
    await waitFor(() => expect(onLanguageChange).toHaveBeenCalledWith("en"));
  });
});
