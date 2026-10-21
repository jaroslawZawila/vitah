// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import { obraOptions } from "../../../../test/obra-picker-fixture";
import ObraPicker from "./ObraPicker";

function renderPicker(onSelect = vi.fn()) {
  render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ObraPicker options={obraOptions} currentId="p-1" onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

const box = () => screen.getByRole("combobox", { name: "Buscar obra por código, cliente o dirección" });
const options = () => within(screen.getByRole("listbox", { name: "Obras" })).getAllByRole("option");

describe("ObraPicker", () => {
  it("shows the obra on screen, and finds any obra by client, address or code", async () => {
    const onSelect = renderPicker();
    expect(screen.getByText("VTH-26-001")).toBeInTheDocument();
    expect(screen.getByText("Barrio Caviedes 12, Valdáliga")).toBeInTheDocument();
    await userEvent.click(box());
    expect(options()).toHaveLength(3);
    expect(options()[0]).toHaveTextContent("obra actual");
    expect(screen.getByRole("status")).toHaveTextContent("3 obras");

    await userEvent.type(box(), "gomez");
    expect(options().map((o) => o.textContent)).toEqual(["VTH-26-002 · Luis GómezCalle Real 3, Comillas"]);
    await userEvent.click(options()[0]!);
    expect(onSelect).toHaveBeenCalledWith("p-2");
    expect(box()).toHaveValue("");
  });

  it("is used from the keyboard: arrows and Enter pick, Escape closes then clears, Enter on a closed list does nothing", async () => {
    const onSelect = renderPicker();
    await userEvent.type(box(), "26");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("p-3");

    await userEvent.type(box(), "suances");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box()).toHaveValue("suances");
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(box()).toHaveValue("");
    // Opening again starts on the first.
    await userEvent.keyboard("{ArrowDown}");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("finds the obra on screen too, and choosing it changes nothing", async () => {
    const onSelect = renderPicker();
    await userEvent.type(box(), "caviedes");
    expect(options()).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    renderPicker();
    await userEvent.type(box(), "zaragoza");
    expect(screen.getByText("Ninguna obra coincide.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ninguna obra");
  });
});
