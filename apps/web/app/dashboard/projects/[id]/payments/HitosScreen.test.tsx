// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { obra } from "../../../../../test/obra-fixture";
import HitosScreen from "./HitosScreen";

vi.mock("../../../../actions/obra", () => ({ savePlanAction: vi.fn() }));
const actions = await import("../../../../actions/obra");

function renderScreen(props: Partial<Parameters<typeof HitosScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <HitosScreen projectId="p-1" projectRef="VTH-26-001" obra={obra} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(actions.savePlanAction).mockReset().mockResolvedValue({ success: true }));

describe("HitosScreen", () => {
  it("shows what is collected, due and to invoice, and each hito", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Pagos" })).toBeInTheDocument();
    expect(screen.getByText("53.784,60 €")).toBeInTheDocument();
    const invoiced = screen.getByText("Facturado, pendiente de cobro").parentElement!;
    expect(within(invoiced).getByText("67.230,75 €")).toBeInTheDocument();
    expect(screen.getByText("H3 · vence el 1 oct 2026")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Envolvente estanca" });
    expect(link).toHaveAttribute("href", "/dashboard/projects/p-1/payments/hito-h4");
    const row = link.closest("[role=row]") as HTMLElement;
    expect(within(row).getByText("13 %")).toBeInTheDocument();
    expect(within(row).getByText("En curso")).toBeInTheDocument();
    expect(within(row).getByText("Comprobaciones 0/1")).toBeInTheDocument();
    expect(within(row).getByText("69 % listo")).toBeInTheDocument();

    const h3 = screen.getByRole("link", { name: "Estructura Steel Frame" }).closest("[role=row]") as HTMLElement;
    expect(within(h3).getByText("Facturado")).toBeInTheDocument();
    expect(within(h3).getByText("Vence 1 oct 2026")).toBeInTheDocument();
    // The fixture's plan adds up to 40 %.
    expect(screen.getByText("Los porcentajes suman 40 %, no el 100 %.")).toBeInTheDocument();
  });

  it("edits the plan's % and chapters", async () => {
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Editar % y capítulos" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Editar % y capítulos" }));
    const pct = dialog.getByLabelText("% de H4");
    await userEvent.clear(pct);
    await userEvent.type(pct, "14");
    const chapters = dialog.getByLabelText("Capítulos de H4");
    await userEvent.clear(chapters);
    await userEvent.type(chapters, "05, 07,10");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar plan" }));

    // Only what changed, saved in one go.
    expect(actions.savePlanAction).toHaveBeenCalledWith("p-1", [
      { id: "hito-h4", pctBp: 1400, chapterCodes: ["05", "07", "10"] },
    ]);
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: "Editar % y capítulos" })).not.toBeInTheDocument();
  });
});
