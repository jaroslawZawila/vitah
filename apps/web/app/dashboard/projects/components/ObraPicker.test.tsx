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
    // Once on the phone's one-line bar, once beside the search (from `sm`).
    expect(screen.getAllByText("VTH-26-001")).toHaveLength(2);
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

  it("is one line on a phone, the obra's code and client, that opens the search and focuses it", async () => {
    const onSelect = renderPicker();
    const bar = screen.getByRole("button", { name: /Cambiar de obra/ });
    expect(bar).toHaveTextContent("ObraVTH-26-001 · Ana Peña Ruiz");
    expect(bar).toHaveClass("sm:hidden");
    expect(bar).toHaveAttribute("aria-expanded", "false");
    // Closed, the search is hidden on a phone only; from `sm` it is always there.
    const search = document.getElementById(bar.getAttribute("aria-controls")!)!;
    expect(search).toContainElement(box());
    expect(search).toHaveClass("max-sm:hidden");

    await userEvent.click(bar);
    expect(bar).toHaveAttribute("aria-expanded", "true");
    expect(search).not.toHaveClass("max-sm:hidden");
    expect(box()).toHaveFocus();
    expect(options()).toHaveLength(3);

    await userEvent.click(options()[1]!);
    expect(onSelect).toHaveBeenCalledWith("p-2");
    expect(bar).toHaveAttribute("aria-expanded", "false");
  });

  it("names an obra without a client by its code alone on the phone's bar", () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages}>
        <ObraPicker options={obraOptions} currentId="p-3" onSelect={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: /Cambiar de obra/ })).toHaveTextContent(/^ObraVTH-26-003Cambiar de obra$/);
  });

  it("says so when nothing matches", async () => {
    renderPicker();
    await userEvent.type(box(), "zaragoza");
    expect(screen.getByText("Ninguna obra coincide.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ninguna obra");
  });
});
