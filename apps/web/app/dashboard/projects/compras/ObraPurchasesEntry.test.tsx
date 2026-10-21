// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import { obraOptions } from "../../../../test/obra-picker-fixture";
import ObraPurchasesEntry from "./ObraPurchasesEntry";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const options = obraOptions;

function renderEntry(list = options) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ObraPurchasesEntry options={list} />
    </NextIntlClientProvider>,
  );
}

describe("ObraPurchasesEntry", () => {
  it("lists the obras, filters them by code, client or address, and opens one's Compras", async () => {
    renderEntry();
    expect(screen.getByRole("heading", { level: 1, name: "Compras" })).toBeInTheDocument();
    const list = () => within(screen.getByRole("region", { name: "Obras" }));
    expect(list().getAllByRole("link")).toHaveLength(3);
    await userEvent.type(screen.getByRole("searchbox", { name: "Código, cliente o dirección" }), "peña");
    expect(list().getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/dashboard/projects/p-1/compras"]);
    await userEvent.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras");
  });

  it("says when nothing matches, or there are no obras", async () => {
    renderEntry();
    await userEvent.type(screen.getByRole("searchbox"), "zaragoza");
    expect(screen.getByText("Ninguna obra coincide.")).toBeInTheDocument();
    renderEntry([]);
    expect(screen.getByText("Todavía no hay obras.")).toBeInTheDocument();
  });
});
