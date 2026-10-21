// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { obraOptions } from "../../../../../test/obra-picker-fixture";
import ComprasObraBar from "./ComprasObraBar";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function renderBar(vista?: string) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ComprasObraBar projectId="p-1" options={obraOptions} vista={vista} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => router.push.mockReset());

describe("ComprasObraBar", () => {
  it("opens another obra on the same view", async () => {
    renderBar("pedidos");
    await userEvent.type(screen.getByRole("combobox"), "comillas");
    await userEvent.click(within(screen.getByRole("listbox")).getByRole("option"));
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-2/compras?vista=pedidos");
  });

  it("opens its lines view when that is where it is", async () => {
    renderBar();
    await userEvent.type(screen.getByRole("combobox"), "suances");
    await userEvent.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-3/compras");
  });
});
