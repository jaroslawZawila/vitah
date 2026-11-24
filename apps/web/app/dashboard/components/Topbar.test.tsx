// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import messages from "../../../messages/es.json";
import Topbar from "./Topbar";

const navigation = { pathname: "/dashboard/projects" };
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

const renderAt = (pathname: string, locale = "es", catalog: typeof messages = messages) => {
  navigation.pathname = pathname;
  return render(
    <NextIntlClientProvider locale={locale} messages={catalog}>
      <Topbar />
    </NextIntlClientProvider>,
  );
};

describe("Topbar", () => {
  it.each([
    ["/dashboard/projects", "Proyectos — Pipeline Completo"],
    ["/dashboard/projects/new", "Nuevo proyecto"],
    ["/dashboard/projects/p-1", "Proyecto — General"],
    ["/dashboard/projects/p-1/obra/planificacion", "Proyecto — Obra"],
    ["/dashboard/projects/p-1/budget/lines", "Proyecto — Presupuesto"],
    ["/dashboard/projects/p-1/compras/o-1", "Proyecto — Compras"],
    ["/dashboard/projects/p-1/payments/h-1", "Proyecto — Pagos"],
    ["/dashboard/projects/p-1/documents", "Proyecto — Documentos"],
    // Every obra's budgets and purchases are lists, not a project.
    ["/dashboard/projects/presupuestos", "Proyectos — Pipeline Completo"],
    ["/dashboard/projects/compras", "Proyectos — Pipeline Completo"],
    ["/dashboard/clients", "Clientes de la app"],
    ["/dashboard/users", "Gestión de Usuarios"],
    ["/dashboard/subcontratas/empresas/s-1", "Subcontratas — Empresas"],
    ["/dashboard/subcontratas/trabajadores", "Subcontratas — Trabajadores"],
    ["/dashboard/compras", "Compras — Pedidos"],
    ["/dashboard/compras/solicitudes", "Compras — Solicitudes"],
    ["/dashboard/compras/facturas/i-1", "Compras — Facturas"],
    ["/dashboard/compras/pagos", "Compras — Pagos"],
    ["/dashboard/compras/proveedores/s-1", "Compras — Proveedores"],
    ["/dashboard/eliminados", "Elementos eliminados"],
    ["/dashboard/contacto", "Contacto para clientes"],
    ["/dashboard/forbidden", "No tienes permiso"],
    ["/dashboard/nothing-here", "Portal"],
  ])("names %s", (pathname, title) => {
    renderAt(pathname);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(document.title).toBe(`${title} · ViTAH`);
  });

  it("shows the strip from lg up only, still naming the browser tab on a phone", () => {
    renderAt("/dashboard/projects/p-1/obra");
    expect(screen.getByText("Proyecto — Obra").closest("header")).toHaveClass("max-lg:hidden");
    expect(document.title).toBe("Proyecto — Obra · ViTAH");
  });

  it("speaks the user's language", () => {
    renderAt("/dashboard/compras/facturas/i-1", "en", en);
    expect(screen.getByText("Purchasing — Invoices")).toBeInTheDocument();
    expect(document.title).toBe("Purchasing — Invoices · ViTAH");
  });
});
