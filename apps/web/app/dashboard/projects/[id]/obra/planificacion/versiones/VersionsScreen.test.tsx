// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/es.json";
import { planningVersions } from "../../../../../../../test/planning-fixture";
import VersionsScreen from "./VersionsScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function renderScreen(data = planningVersions) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <VersionsScreen projectId="p-1" data={data} />
    </NextIntlClientProvider>,
  );
}

const list = () => within(screen.getByRole("list", { name: "Versiones" }));

describe("VersionsScreen", () => {
  it("lists the versions and compares the baseline with the one before", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Versiones del plan" })).toBeInTheDocument();
    expect(list().getAllByRole("button").map((b) => b.querySelector("span span")?.textContent)).toEqual([
      "Borrador v3",
      "Línea base v2",
      "Línea base v1",
    ]);
    expect(list().getByRole("button", { name: /Línea base v2/ })).toHaveAttribute("aria-pressed", "true");
    expect(list().getByText("«Lluvias de septiembre»")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "v2 frente a v1" })).toBeInTheDocument();
    expect(screen.getByText("1 capítulo cambia de fechas")).toBeInTheDocument();
    const painting = within(screen.getByRole("row", { name: /Pinturas y varios/ }));
    expect(painting.getByText("16/11 – 03/12")).toBeInTheDocument();
    expect(painting.getByText("23/11 – 10/12")).toBeInTheDocument();
    expect(painting.getByText("+7 d")).toBeInTheDocument();
  });

  it("shows the first version on its own, and the draft against the baseline", async () => {
    renderScreen();
    await userEvent.click(list().getByRole("button", { name: /Línea base v1/ }));
    expect(screen.getByRole("heading", { name: "v1" })).toBeInTheDocument();
    expect(screen.getByText("La primera versión: nada con qué comparar.")).toBeInTheDocument();

    await userEvent.click(list().getByRole("button", { name: /Borrador v3/ }));
    expect(screen.getByRole("heading", { name: "v3 frente a v2" })).toBeInTheDocument();
    expect(screen.getByText("Ninguna fecha cambia")).toBeInTheDocument();
  });

  it("says when there is nothing yet", () => {
    renderScreen({ ref: "VTH-26-001", versions: [] });
    expect(screen.getByText("Todavía no hay versiones del plan.")).toBeInTheDocument();
  });
});
