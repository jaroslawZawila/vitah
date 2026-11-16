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
    // The hitos' agreed amounts, without VAT, as the summary says.
    expect(screen.getByText("Cobrado · sin IVA").parentElement).toHaveTextContent("53.784,60 €");
    const invoiced = screen.getByText("Facturado, pendiente de cobro · sin IVA").parentElement!;
    expect(within(invoiced).getByText("67.230,75 €")).toBeInTheDocument();
    expect(screen.getByText("Por facturar · sin IVA")).toBeInTheDocument();
    expect(screen.getByText("H3 · vence el 1 oct 2026")).toBeInTheDocument();

    const table = within(screen.getByRole("table", { name: "Pagos" }));
    const link = table.getByRole("link", { name: "Envolvente estanca" });
    expect(link).toHaveAttribute("href", "/dashboard/projects/p-1/payments/hito-h4");
    const row = link.closest("[role=row]") as HTMLElement;
    expect(within(row).getByText("13 %")).toBeInTheDocument();
    expect(within(row).getByText("En curso")).toBeInTheDocument();
    expect(within(row).getByText("Comprobaciones 0/1")).toBeInTheDocument();
    expect(within(row).getByText("69 % listo")).toBeInTheDocument();

    const h3 = table.getByRole("link", { name: "Estructura Steel Frame" }).closest("[role=row]") as HTMLElement;
    expect(within(h3).getByText("Facturado")).toBeInTheDocument();
    expect(within(h3).getByText("Vence 1 oct 2026")).toBeInTheDocument();
    // The fixture's plan adds up to 40 %.
    expect(screen.getByText("Los porcentajes suman 40 %, no el 100 %.")).toBeInTheDocument();
  });

  it("gives phones a card per hito, the whole card its link, then the plan's total", () => {
    const requested = obra.hitos.map((h) => (h.code === "H4" ? { ...h, invoiceRequestedAt: "2026-10-17T10:00:00.000Z" } : h));
    renderScreen({ obra: { ...obra, hitos: requested } });

    const cards = within(screen.getByRole("list", { name: "Pagos" }));
    expect(cards.getAllByRole("listitem")).toHaveLength(obra.hitos.length);
    const link = cards.getByRole("link", { name: "Envolvente estanca" });
    expect(link).toHaveAttribute("href", "/dashboard/projects/p-1/payments/hito-h4");
    // The link covers its card, so a finger can tap anywhere on it.
    expect(link).toHaveClass("after:absolute", "after:inset-0");
    const h4 = link.closest("li")!;
    expect(h4).toHaveClass("relative");
    expect(within(h4).getByText("13 %")).toBeInTheDocument();
    expect(within(h4).getByText("58.266,65 €")).toBeInTheDocument();
    expect(within(h4).getByText("Vivienda cerrada al agua y al aire")).toBeInTheDocument();
    expect(within(h4).getByText("En curso")).toBeInTheDocument();
    expect(within(h4).getByText("Comprobaciones 0/1")).toBeInTheDocument();
    expect(within(h4).getByText("Factura solicitada · 17 oct 2026")).toBeInTheDocument();
    expect(within(h4).getByText("69 % listo")).toBeInTheDocument();

    const h3 = cards.getByRole("link", { name: "Estructura Steel Frame" }).closest("li")!;
    expect(within(h3).getByText("Vence 1 oct 2026")).toBeInTheDocument();
    expect(screen.getAllByText("TOTAL PLAN H0–H9")).toHaveLength(2);
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

  it("shows Administration the invoice the Obra tab asked for", () => {
    const requested = obra.hitos.map((h) =>
      h.code === "H4" ? { ...h, invoiceRequestedAt: "2026-10-17T10:00:00.000Z" } : h.code === "H3" ? { ...h, invoiceRequestedAt: "2026-09-11T10:00:00.000Z" } : h,
    );
    renderScreen({ obra: { ...obra, hitos: requested } });

    const table = within(screen.getByRole("table", { name: "Pagos" }));
    const h4 = table.getByRole("link", { name: "Envolvente estanca" }).closest("[role=row]") as HTMLElement;
    expect(within(h4).getByText("Factura solicitada · 17 oct 2026")).toBeInTheDocument();
    // Once invoiced, the request is done.
    const h3 = table.getByRole("link", { name: "Estructura Steel Frame" }).closest("[role=row]") as HTMLElement;
    expect(within(h3).queryByText(/Factura solicitada/)).not.toBeInTheDocument();
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: "Editar % y capítulos" })).not.toBeInTheDocument();
  });
});
