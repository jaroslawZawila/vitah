// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { emptyPlanning, planning } from "../../../../../../test/planning-fixture";
import PlanningScreen from "./PlanningScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../../actions/planning", () => ({ createPlanningDraftAction: vi.fn() }));
const actions = await import("../../../../../actions/planning");

const header = { ref: "VTH-26-001", stage: 6 as const, openIssues: 0 };

function renderScreen(props: Partial<Parameters<typeof PlanningScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PlanningScreen projectId="p-1" header={header} planning={planning} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  router.push.mockReset();
  vi.mocked(actions.createPlanningDraftAction).mockReset().mockResolvedValue({ success: true });
});

const table = () => within(screen.getByRole("table"));

describe("PlanningScreen", () => {
  it("shows the baseline, where the works are heading and each chapter's plan", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Planificación" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Planificación" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Línea base v2")).toBeInTheDocument();
    expect(screen.getByText(/motivo: «Lluvias de septiembre»/)).toBeInTheDocument();

    const kpis = within(screen.getByRole("region", { name: "Resumen del plan" }));
    expect(kpis.getByText("17/12/2026")).toBeInTheDocument();
    expect(kpis.getByText("6 días sobre el contrato")).toBeInTheDocument();
    expect(kpis.getByText("Empieza en 9 días: 150 €/día")).toBeInTheDocument();
    expect(kpis.getByText("02 → 03 → 04")).toBeInTheDocument();

    expect(table().getByRole("link", { name: "Revestimientos interiores y falsos techos" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/obra/avance/03",
    );
    const finishes = within(table().getByRole("row", { name: /Revestimientos interiores/ }));
    expect(finishes.getByText("Tras 02 · H8")).toBeInTheDocument();
    expect(finishes.getByText("Crítica")).toBeInTheDocument();
    expect(finishes.getByText("+7 d vs. línea base")).toBeInTheDocument();
    expect(finishes.getByText("02/11 – 27/11")).toBeInTheDocument();
    // Pending: its orders go out 14 days before its baseline start (26/10).
    expect(finishes.getByText("· pedir antes del 12/10")).toBeInTheDocument();
    expect(table().getByText("Toda la obra")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Versiones" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion/versiones");
  });

  it("filters to the critical path and hides the baseline bars", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Solo ruta crítica" }));
    expect(table().queryByText("Actuaciones previas y movimiento de tierras")).not.toBeInTheDocument();
    expect(table().getByText("Cimentación y estructura")).toBeInTheDocument();

    expect(screen.getByText("Línea base", { selector: "span" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Comparar con la línea base" }));
    expect(screen.getByRole("button", { name: "Comparar con la línea base" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Línea base", { selector: "span" })).not.toBeInTheDocument();
  });

  it("opens a draft of the baseline, or goes back to the open one", async () => {
    const { unmount } = renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Editar plan" }));
    expect(actions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", { from: "baseline" });
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar");
    unmount();

    renderScreen({ planning: { ...planning, draft: { ...planning.baseline!, id: "v3", number: 3, status: "draft", approvedAt: null, approvedBy: null } } });
    expect(screen.getByRole("link", { name: "Seguir con el borrador v3" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion/editar");
    expect(screen.getByText("Borrador v3")).toBeInTheDocument();
  });

  it("shows an error from opening the draft", async () => {
    vi.mocked(actions.createPlanningDraftAction).mockResolvedValue({ error: "draft_exists" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Editar plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay un borrador abierto");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("generates a first plan from the template, with a preview", async () => {
    renderScreen({ planning: emptyPlanning });
    expect(screen.getByText("Esta obra aún no tiene plan.")).toBeInTheDocument();
    expect(screen.getByLabelText("Inicio de obra (acta de inicio)")).toHaveValue("2026-03-02");
    expect(screen.getByText("Fin del borrador")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Festivos autonómicos"), "as");
    await userEvent.click(screen.getByLabelText("Navidad: del 24/12 al 6/1"));
    await userEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(actions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", {
      from: "template",
      startDate: "2026-03-02",
      region: "as",
      augustClosure: true,
      christmasClosure: false,
    });
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar");
  });

  it("can copy another project's plan", async () => {
    renderScreen({ planning: emptyPlanning });
    await userEvent.click(screen.getByRole("radio", { name: /Copiar de otra obra/ }));
    expect(screen.getByLabelText("Obra")).toHaveValue("p-2");
    await userEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(actions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", expect.objectContaining({ from: "project", projectId: "p-2" }));
  });

  it("only tells viewers there is no plan, and says when there is no budget", () => {
    const { unmount } = renderScreen({ planning: emptyPlanning, canManage: false });
    expect(screen.getByText("Un administrador o gestor puede generar el plan.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crear borrador" })).not.toBeInTheDocument();
    unmount();

    renderScreen({ planning: { ...emptyPlanning, chapters: [] } });
    expect(screen.getByText("Para planificar la obra hace falta un presupuesto aceptado.")).toBeInTheDocument();
  });

  it("lets viewers see the plan without changing it", () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole("button", { name: "Editar plan" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Versiones" })).toBeInTheDocument();
  });
});
