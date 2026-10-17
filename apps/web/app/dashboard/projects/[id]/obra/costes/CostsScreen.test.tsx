// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../../messages/es.json";
import { costs, header } from "../../../../../../test/construction-fixture";
import CostsScreen from "./CostsScreen";

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <CostsScreen projectId="p-1" header={header} costs={costs} budgetNumber={1} />
    </NextIntlClientProvider>,
  );
}

const lines = () =>
  within(screen.getByRole("region", { name: "Partidas" }))
    .queryAllByRole("row")
    .map((row) => row.querySelector("td")?.textContent)
    .filter((code): code is string => !!code && /^\d+\.\d+$/.test(code));

describe("CostsScreen", () => {
  it("compares each line's cost with what was contracted, chapters in progress open", () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Costes por partida" })).toBeInTheDocument();
    expect(screen.getByText("Presupuesto Rev.1")).toBeInTheDocument();
    expect(screen.getByText("Simulado")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /06\s*Envolvente/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /05\s*Cubierta/ })).toHaveAttribute("aria-expanded", "false");
    expect(lines()).toEqual(["06.01", "06.02", "06.06"]);

    const saving = screen.getByText("Panel Thermochip de fachada").closest("tr")!;
    expect(within(saving).getByText("+450,00")).toHaveClass("text-good");
    expect(within(saving).getByText("+3,6 %")).toBeInTheDocument();
    const overrun = screen.getByText("Lámina transpirable Tyvek").closest("tr")!;
    expect(within(overrun).getByText("−70,72")).toHaveClass("text-bad");
    // Not contracted: no zero anywhere.
    const open = screen.getByText("Perfilería de arranque y goterones").closest("tr")!;
    expect(within(open).getByText("Sin contratar")).toBeInTheDocument();
    expect(within(open).queryByText(/^[+−]?0,00/)).not.toBeInTheDocument();
  });

  it("opens and closes a chapter", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /05\s*Cubierta/ }));
    expect(lines()).toContain("05.01");
    await userEvent.click(screen.getByRole("button", { name: /06\s*Envolvente/ }));
    expect(lines()).toEqual(["05.01"]);
  });

  it("filters by contracting and by text", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Con sobrecoste" }));
    expect(lines()).toEqual(["06.02", "05.01"]);

    await userEvent.click(screen.getByRole("button", { name: "Sin contratar" }));
    expect(lines()).toEqual(["06.06"]);

    await userEvent.click(screen.getByRole("button", { name: "Todas" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "teja");
    expect(lines()).toEqual(["05.01"]);

    await userEvent.clear(screen.getByRole("searchbox", { name: "Buscar partida" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar partida" }), "nada de esto");
    expect(screen.getByText("Ninguna partida coincide con los filtros.")).toBeInTheDocument();
  });
});
