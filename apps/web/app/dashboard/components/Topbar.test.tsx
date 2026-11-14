// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import Topbar from "./Topbar";

const navigation = { pathname: "/dashboard/projects" };
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

describe("Topbar", () => {
  it.each([
    ["/dashboard/projects", "Proyectos — Pipeline Completo"],
    ["/dashboard/projects/new", "Nuevo proyecto"],
    ["/dashboard/projects/p-1/obra", "Detalle de Proyecto"],
    // Every obra's budgets and purchases are lists, not a project.
    ["/dashboard/projects/presupuestos", "Proyectos — Pipeline Completo"],
    ["/dashboard/projects/compras", "Proyectos — Pipeline Completo"],
    ["/dashboard/clients", "Clientes de la app"],
    ["/dashboard/users", "Gestión de Usuarios"],
    ["/dashboard/subcontratas/empresas", "Subcontratas"],
    ["/dashboard/compras", "Compras"],
    ["/dashboard/compras/facturas/i-1", "Compras"],
    ["/dashboard/eliminados", "Elementos eliminados"],
  ])("names %s", (pathname, title) => {
    navigation.pathname = pathname;
    render(
      <NextIntlClientProvider locale="es" messages={messages}>
        <Topbar />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(title)).toBeInTheDocument();
  });
});
