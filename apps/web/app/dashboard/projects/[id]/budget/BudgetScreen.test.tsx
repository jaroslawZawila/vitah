// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBudget } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import { budget } from "../../../../../test/obra-fixture";
import BudgetScreen from "./BudgetScreen";

vi.mock("../../../../actions/budget", () => ({
  createBudgetAction: vi.fn(),
  createRevisionAction: vi.fn(),
  updateRevisionAction: vi.fn(),
  acceptRevisionAction: vi.fn(),
  deleteRevisionAction: vi.fn(),
  addChapterAction: vi.fn(),
  updateChapterAction: vi.fn(),
  deleteChapterAction: vi.fn(),
  addLineAction: vi.fn(),
  updateLineAction: vi.fn(),
  deleteLineAction: vi.fn(),
}));
const actions = await import("../../../../actions/budget");

const draft: ProjectBudget = {
  revisions: [{ ...budget.revisions[0]!, id: "rev-4", number: 4, status: "draft", acceptedAt: null }, ...budget.revisions],
  revision: { ...budget.revision!, id: "rev-4", number: 4, status: "draft", acceptedAt: null, previous: { number: 3, totalCents: 44_820_503 } },
};

function renderScreen(props: Partial<Parameters<typeof BudgetScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <BudgetScreen projectId="p-1" projectRef="VTH-26-001" budget={budget} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(actions)) (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("BudgetScreen", () => {
  it("shows the accepted revision: figures, changes and chapters", async () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Presupuesto" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Rev\.2 · 419\.500,73\s€ · superada$/ })).toHaveAttribute("href", "/dashboard/projects/p-1/budget?revision=rev-2");
    expect(screen.getByRole("link", { name: /^Rev\.3 · 448\.205,03\s€ · aceptada$/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("+28.704,30 € respecto a Rev.2")).toBeInTheDocument();
    expect(screen.getByText("493.025,53 €")).toBeInTheDocument();
    expect(screen.getByText("253,45 m² construidos")).toBeInTheDocument();

    const changes = within(screen.getByRole("table", { name: "Cambios respecto a Rev.2" }));
    const row05 = changes.getByText("Envolvente Térmica — Paneles Thermochip").closest("[role=row]") as HTMLElement;
    expect(within(row05).getByText("+5056,03 €")).toBeInTheDocument();
    expect(within(row05).getByText("Precio de mercado")).toBeInTheDocument();

    // The first chapter starts open.
    expect(screen.getByRole("button", { name: /05 Envolvente Térmica/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Barrera de vapor Blowerproof")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /16 Seguridad y Salud/ }));
    expect(screen.getByRole("button", { name: /16 Seguridad y Salud/ })).toHaveAttribute("aria-expanded", "true");
    // An accepted revision is the contract: no editing.
    expect(screen.queryByRole("textbox", { name: "Cantidad de 05.03" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar revisión" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Nueva revisión" }));
    expect(actions.createRevisionAction).toHaveBeenCalledWith("p-1");
  });

  it("edits a draft inline and accepts it", async () => {
    renderScreen({ budget: draft });

    const price = screen.getByRole("textbox", { name: "Precio unitario de 05.03" });
    await userEvent.clear(price);
    await userEvent.type(price, "9,50");
    await userEvent.tab();
    expect(actions.updateLineAction).toHaveBeenCalledWith("p-1", "line-2", { unitPriceCents: 950 });

    await userEvent.click(screen.getByRole("button", { name: "Aceptar revisión" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(actions.acceptRevisionAction).toHaveBeenCalledWith("p-1", "rev-4");
  });

  it("adds a chapter and a line to a draft", async () => {
    renderScreen({ budget: draft });

    await userEvent.click(screen.getByRole("button", { name: "Añadir capítulo" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Añadir capítulo" }));
    await userEvent.type(dialog.getByLabelText("Código"), "18");
    await userEvent.type(dialog.getByLabelText("Denominación"), "Piscina");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    expect(actions.addChapterAction).toHaveBeenCalledWith("p-1", "rev-4", { code: "18", name: "Piscina", changeNote: "" });

    await userEvent.click(screen.getByRole("button", { name: "Añadir partida" }));
    const lineDialog = within(await screen.findByRole("dialog", { name: "Añadir partida" }));
    // The code starts with the chapter's.
    expect(lineDialog.getByLabelText("Código")).toHaveValue("05.");
    await userEvent.type(lineDialog.getByLabelText("Código"), "07");
    await userEvent.type(lineDialog.getByLabelText("Descripción"), "Remates");
    await userEvent.type(lineDialog.getByLabelText("Unidad"), "pa");
    await userEvent.type(lineDialog.getByLabelText("Cantidad"), "1");
    await userEvent.type(lineDialog.getByLabelText("Precio unitario (€)"), "1.250,50");
    await userEvent.click(lineDialog.getByRole("button", { name: "Guardar" }));
    expect(actions.addLineAction).toHaveBeenCalledWith("p-1", "chapter-05", {
      code: "05.07",
      description: "Remates",
      unit: "pa",
      quantity: 1,
      unitPriceCents: 125_050,
    });
  });

  it("starts a budget", async () => {
    renderScreen({ budget: { revisions: [], revision: null } });

    expect(screen.getByRole("heading", { name: "Todavía no hay presupuesto" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear presupuesto" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Crear presupuesto" }));
    await userEvent.type(dialog.getByLabelText("Número de presupuesto"), "036/2026");
    await userEvent.click(dialog.getByRole("button", { name: "Guardar" }));
    expect(actions.createBudgetAction).toHaveBeenCalledWith("p-1", { reference: "036/2026", number: 0 });
  });

  it("is read-only for viewers", () => {
    renderScreen({ budget: draft, canManage: false });
    expect(screen.queryByRole("button", { name: "Nueva revisión" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir capítulo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar revisión" })).not.toBeInTheDocument();
  });
});
