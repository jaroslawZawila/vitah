// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import type { SubcontractorCounts } from "@repo/core/contract";
import Sidebar from "./Sidebar";

const navigation = { pathname: "/dashboard/projects", params: {} as { id?: string } };
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useParams: () => navigation.params,
}));

/** Next only sets `id` on `projects/[id]` routes. */
function renderAt(pathname: string, isAdmin = true, subcontractors: SubcontractorCounts | null = null) {
  navigation.pathname = pathname;
  navigation.params = /^\/dashboard\/projects\/(?!new$)[^/]+/.test(pathname)
    ? { id: pathname.split("/")[3] }
    : {};
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <Sidebar name="Laura" email="laura@vitah.es" isAdmin={isAdmin} subcontractors={subcontractors} />
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

  it("marks Compras current on its page", () => {
    renderAt("/dashboard/compras");
    expect(screen.getByRole("link", { name: "Compras" })).toHaveAttribute("aria-current", "page");
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
});
