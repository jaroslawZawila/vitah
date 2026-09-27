// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { obra } from "../../../../../test/obra-fixture";
import ObraScreen from "./ObraScreen";

vi.mock("../../../../actions/obra", () => ({ setObraStageAction: vi.fn() }));
const actions = await import("../../../../actions/obra");

function renderScreen(props: Partial<Parameters<typeof ObraScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ObraScreen projectId="p-1" projectRef="VTH-26-001" obra={obra} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(actions.setObraStageAction).mockReset());

describe("ObraScreen", () => {
  it("shows the process, the key figures and the chapters", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Obra" })).toBeInTheDocument();
    expect(screen.getByText("Presupuesto 036/2026 · Rev.3")).toBeInTheDocument();

    const steps = within(screen.getByRole("list", { name: "Proceso" }));
    expect(steps.getAllByRole("listitem")).toHaveLength(8);
    expect(steps.getByText("6 · Ejecución de obra").closest("li")).toHaveAttribute("aria-current", "step");
    expect(steps.getByText("Rev.3 aceptada · 448.205,03 €")).toBeInTheDocument();
    expect(steps.getByText("H0 pagado 3 feb 2026")).toBeInTheDocument();

    expect(screen.getByText("52 %")).toBeInTheDocument();
    expect(screen.getByText("232.856,84 € de 448.205,03 €")).toBeInTheDocument();
    expect(screen.getByText("H3 facturado · vence 1 oct 2026")).toBeInTheDocument();
    expect(screen.getByText("En plazo")).toBeInTheDocument();
    // The next hito is the first one not yet paid: H3, invoiced.
    const next = screen.getByText("Próximo hito").parentElement!;
    expect(within(next).getByText("H3 · Estructura Steel Frame")).toBeInTheDocument();
    expect(within(next).getByText("Facturado · 67.230,75 €")).toBeInTheDocument();

    const chapter = screen.getByRole("link", { name: "Envolvente Térmica — Paneles Thermochip" });
    expect(chapter).toHaveAttribute("href", "/dashboard/projects/p-1/obra/05");
    const row = chapter.closest("[role=row]") as HTMLElement;
    expect(within(row).getByText("80 %")).toBeInTheDocument();
    expect(within(row).getByText("En curso")).toBeInTheDocument();
    expect(within(row).getByText("H4")).toBeInTheDocument();
  });

  it("moves the project to another stage", async () => {
    vi.mocked(actions.setObraStageAction).mockResolvedValue({ success: true });
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Pasar a la etapa 7: Recepción y entrega" }));

    expect(actions.setObraStageAction).toHaveBeenCalledWith("p-1", 7);
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: /Pasar a la etapa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Actualizar avance" })).not.toBeInTheDocument();
  });

  it("points to the budget before one is accepted", () => {
    renderScreen({ obra: { ...obra, budget: null, chapters: [], hitos: [], stage: 3 } });

    expect(screen.getByRole("heading", { name: "Todavía no hay presupuesto aceptado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al presupuesto" })).toHaveAttribute("href", "/dashboard/projects/p-1/budget");
  });
});
