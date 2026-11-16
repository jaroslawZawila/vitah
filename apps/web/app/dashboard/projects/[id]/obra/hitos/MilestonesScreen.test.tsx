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

  it("gives phones a card per hito with its state, chapters and amounts labelled", () => {
    renderScreen();

    const cards = within(screen.getByRole("list", { name: "Hitos" }));
    const h4 = within(cards.getByText("Envolvente estanca").closest("li")!);
    expect(h4.getByText("Pendiente")).toBeInTheDocument();
    expect(h4.getByText("falta 06 · en curso")).toBeInTheDocument();
    expect(h4.getByText(/^Acordado/).nextElementSibling).toHaveTextContent("80.792,40");
    // Nothing invoiced yet: only the agreed amount.
    expect(h4.queryByText("Facturado")).not.toBeInTheDocument();
    // Its chapters as chips that wrap, each with its state for screen readers.
    expect(h4.getByText("06").closest("ul")).toHaveClass("flex-wrap");
    expect(h4.getByText("En curso")).toHaveClass("sr-only");

    const h3 = within(cards.getByText("Estructura Steel Frame").closest("li")!);
    expect(h3.getByText("Facturado", { selector: "dt" })).toBeInTheDocument();
    expect(h3.getByText("Cobrado", { selector: "dt" })).toBeInTheDocument();
    expect(h3.getByRole("link", { name: /Ver factura/ })).toHaveAttribute("href", "/dashboard/projects/p-1/payments/hito-h3");

    const total = within(screen.getByRole("region", { name: "Total" }));
    expect(total.getByText("Pendiente", { selector: "dt" }).nextElementSibling?.firstElementChild).toHaveClass("text-warn");
  });

  it("lists the invoice requests and where they stand", () => {
    renderScreen();

    const requests = within(screen.getByRole("table", { name: "Solicitudes de factura" }));
    const row = requests.getByText("H3 Estructura Steel Frame (03)").closest("tr")!;
    expect(within(row).getByText("· Marta Ruiz Gómez")).toBeInTheDocument();
    expect(within(row).getByText("11 sept 2026")).toBeInTheDocument();
    expect(within(row).getByText("al finalizar 03 · Rubén García")).toBeInTheDocument();
    expect(within(row).getByText("Facturada 25 sept 2026")).toBeInTheDocument();

    // On a phone, one entry per request with its amount labelled.
    const entries = within(screen.getByRole("list", { name: "Solicitudes de factura" }));
    const entry = within(entries.getByText("H3 Estructura Steel Frame (03)").closest("li")!);
    expect(entry.getByText("Facturada 25 sept 2026")).toBeInTheDocument();
    expect(entry.getByText("Importe · sin IVA")).toBeInTheDocument();
  });
});
