// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/es.json";
import { tenantRequests } from "../../../../test/request-fixture";
import RequestsScreen from "./RequestsScreen";

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <RequestsScreen requests={tenantRequests} />
    </NextIntlClientProvider>,
  );
}

describe("RequestsScreen (company)", () => {
  it("lists every obra's requests, each linking to its obra's page, and filters by obra", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Solicitudes" })).toBeInTheDocument();
    const table = within(screen.getByRole("table", { name: "Solicitudes de compra" }));
    expect(table.getAllByRole("row")).toHaveLength(5);
    expect(table.getAllByRole("link", { name: "SOL-001" }).map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard/projects/p-1/compras/solicitudes/req-1",
      "/dashboard/projects/p-3/compras/solicitudes/req-9",
    ]);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Obra" }), "VTH-26-003");
    expect(table.getAllByRole("row")).toHaveLength(2);
    expect(table.getByText("Ventanas")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: /Cerradas\s*1/ })).toBeInTheDocument();
  });

  it("says so when there are none", () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
        <RequestsScreen requests={{ ...tenantRequests, requests: [] }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText("Todavía no hay solicitudes.")).toHaveLength(1);
  });
});
