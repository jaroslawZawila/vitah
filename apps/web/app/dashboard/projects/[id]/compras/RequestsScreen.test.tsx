// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/es.json";
import { requests, tenantRequests } from "../../../../../test/request-fixture";
import RequestsScreen from "./RequestsScreen";

const header = { ref: "VTH-26-001", stage: 4 as const, openIssues: 0 };

function renderScreen(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <RequestsScreen
        projectId="p-1"
        header={header}
        requests={{ ...tenantRequests, requests, projects: tenantRequests.projects.slice(0, 1) }}
        canManage={canManage}
      />
    </NextIntlClientProvider>,
  );
}

const table = () => within(screen.getByRole("table", { name: "Solicitudes de compra" }));

describe("RequestsScreen (project)", () => {
  it("lists the obra's requests, those to approve first, with what waits and the way to ask", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Solicitudes de compra" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Vista" })).toHaveTextContent("PartidasSolicitudesPedidos");
    expect(screen.getByRole("link", { name: "Solicitudes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Nueva solicitud/ })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/solicitudes/nueva");

    const kpis = within(screen.getByRole("region", { name: "Resumen" }));
    expect(kpis.getByText("Por aprobar").parentElement).toHaveTextContent("1");

    const rows = table().getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual(["SOL-003", "SOL-002", "SOL-001"]);
    expect(rows[0]).toHaveTextContent("2 d tarde");
    expect(rows[1]).toHaveTextContent("—");
    expect(rows[2]).toHaveTextContent("PED-049");
    expect(table().getByRole("link", { name: "SOL-003" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/solicitudes/req-3");
    // No obra filter inside an obra.
    expect(screen.queryByRole("combobox", { name: "Obra" })).not.toBeInTheDocument();
  });

  it("filters by state", async () => {
    renderScreen();
    const groups = within(screen.getByRole("group", { name: "Estado" }));
    expect(groups.getByRole("button", { name: /Por pedir\s*1/ })).toBeInTheDocument();
    await userEvent.click(groups.getByRole("button", { name: /Cerradas/ }));
    expect(table().getAllByRole("row").slice(1)).toHaveLength(1);
    expect(table().getByText("SOL-001")).toBeInTheDocument();
  });

  it("offers viewers no new request", () => {
    renderScreen(false);
    expect(screen.queryByRole("link", { name: /Nueva solicitud/ })).not.toBeInTheDocument();
  });
});
