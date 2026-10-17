// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../messages/es.json";
import { control, header } from "../../../../../../test/construction-fixture";
import MilestonesScreen from "./MilestonesScreen";

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <MilestonesScreen projectId="p-1" header={header} control={control} />
    </NextIntlClientProvider>,
  );
}

describe("MilestonesScreen", () => {
  it("shows the states a hito goes through", () => {
    renderScreen();
    const steps = within(screen.getByRole("list", { name: "Estados de un hito" }));
    expect(steps.getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual([
      "Pendiente",
      "Hito alcanzado",
      "Factura solicitada",
      "Facturado",
      "Cobrado",
    ]);
  });

  it("lists each hito with its chapters, amounts and invoice", () => {
    renderScreen();

    const table = within(screen.getByRole("region", { name: "Hitos" }));
    const h4 = table.getByText("Envolvente estanca").closest("tr")!;
    expect(within(h4).getByText("falta 06 · en curso")).toBeInTheDocument();
    expect(within(h4).getByText("80.792,40")).toBeInTheDocument();
    expect(within(h4).getByText("Pendiente")).toBeInTheDocument();
    expect(within(h4).getAllByText("—").length).toBeGreaterThanOrEqual(3);

    const h3 = table.getByText("Estructura Steel Frame").closest("tr")!;
    expect(within(h3).getByText("Facturado")).toBeInTheDocument();
    expect(within(h3).getByRole("link", { name: /Ver factura/ })).toHaveAttribute("href", "/dashboard/projects/p-1/payments/hito-h3");
  });

  it("lists the invoice requests and where they stand", () => {
    renderScreen();

    const requests = within(screen.getByRole("table", { name: "Solicitudes de factura" }));
    const row = requests.getByText("H3 Estructura Steel Frame (03)").closest("tr")!;
    expect(within(row).getByText("· Marta Ruiz Gómez")).toBeInTheDocument();
    expect(within(row).getByText("11/09")).toBeInTheDocument();
    expect(within(row).getByText("al finalizar 03 · Rubén García")).toBeInTheDocument();
    expect(within(row).getByText("Facturada 25/09")).toBeInTheDocument();
  });
});
