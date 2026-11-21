// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
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
    expect(kpis.getByText("17 dic 2026")).toBeInTheDocument();
    expect(kpis.getByText("6 días sobre el contrato")).toBeInTheDocument();
    expect(kpis.queryByText(/€/)).not.toBeInTheDocument();
    expect(kpis.getByText("02 → 03 → 04")).toBeInTheDocument();

    // The same status Obra › Resumen states: late, the forecast past the contract first.
    const schedule = within(screen.getByRole("region", { name: "Plazo" }));
    expect(schedule.getByText("+6 d")).toBeInTheDocument();
    expect(schedule.getByText("sobre el contrato")).toBeInTheDocument();
    expect(schedule.getByText("Fin previsto 17 dic 2026: 6 días después del contrato (11 dic 2026).")).toBeInTheDocument();
    expect(schedule.queryByText(/€/)).not.toBeInTheDocument();
    expect(schedule.queryByText("En plazo")).not.toBeInTheDocument();

    expect(table().getByRole("link", { name: "Revestimientos interiores y falsos techos" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p-1/obra/avance/03",
    );
    const finishes = within(table().getByRole("row", { name: /Revestimientos interiores/ }));
    expect(finishes.getByText("Tras 02 · H8")).toBeInTheDocument();
    expect(finishes.getByText("Crítica")).toBeInTheDocument();
    expect(finishes.getByText("+7 d vs. línea base")).toBeInTheDocument();
    expect(finishes.getByText("2 nov 2026 – 27 nov 2026")).toBeInTheDocument();
    // Pending: its orders go out 14 days before its baseline start (26/10).
    expect(finishes.getByText("· pedir antes del 12 oct 2026")).toBeInTheDocument();
    expect(table().getByText("Toda la obra")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Versiones" })).toHaveAttribute("href", "/dashboard/projects/p-1/obra/planificacion/versiones");
  });

  it("gives phones a card per chapter in the order the works go, each the way into its chapter", () => {
    renderScreen();
    const cards = within(screen.getByRole("list", { name: "Plan por capítulo" }));
    // By forecast start; 17 spans the whole works, so it comes last.
    expect(cards.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Actuaciones previas y movimiento de tierras",
      "Cimentación y estructura",
      "Revestimientos interiores y falsos techos",
      "Pinturas y varios",
      "Control de calidad",
    ]);

    const link = cards.getByRole("link", { name: "Revestimientos interiores y falsos techos" });
    expect(link).toHaveAttribute("href", "/dashboard/projects/p-1/obra/avance/03");
    // The link covers its card, so a finger can tap anywhere on it.
    expect(link).toHaveClass("after:absolute", "after:inset-0");
    const card = link.closest("li")!;
    expect(card).toHaveClass("relative");
    const pending = within(card);
    expect(pending.getByText("Pendiente")).toBeInTheDocument();
    expect(pending.getByText("+7 d vs. línea base")).toBeInTheDocument();
    expect(pending.getByText("Crítica")).toBeInTheDocument();
    const value = (term: string) => pending.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;
    expect(value("Línea base")).toBe("26 oct 2026 – 20 nov 2026");
    expect(value("Previsto")).toBe("2 nov 2026 – 27 nov 2026");
    expect(value("Duración")).toBe("20 días laborables");
    expect(value("Empieza")).toBe("Tras 02 · H8");
    expect(value("Pedir antes del")).toBe("12 oct 2026");
    expect(pending.queryByText("Real")).not.toBeInTheDocument();

    const started = within(cards.getByRole("link", { name: "Cimentación y estructura" }).closest("li")!);
    expect(started.getByText("Real", { selector: "dt" }).nextElementSibling).toHaveTextContent("desde el 17 mar 2026 · 70 %");
    expect(started.queryByText("Pedir antes del")).not.toBeInTheDocument();
    const finished = within(cards.getByRole("link", { name: "Actuaciones previas y movimiento de tierras" }).closest("li")!);
    expect(finished.getByText("Real", { selector: "dt" }).nextElementSibling).toHaveTextContent("2 mar 2026 – 16 mar 2026");
  });

  it("says on a phone's card which chapters the schedule status finds late", () => {
    renderScreen({
      planning: {
        ...planning,
        schedule: {
          ...planning.schedule,
          status: "late",
          lateToStart: [{ code: "03", name: "Revestimientos interiores y falsos techos", plannedDate: "2026-10-26", days: 3 }],
          lateToFinish: [{ code: "02", name: "Cimentación y estructura", plannedDate: "2026-10-23", days: 2 }],
        },
      },
    });
    const cards = within(screen.getByRole("list", { name: "Plan por capítulo" }));
    const card = (name: string) => within(cards.getByRole("link", { name }).closest("li")!);
    expect(card("Revestimientos interiores y falsos techos").getByText("Inicio previsto superado · +3 d")).toBeInTheDocument();
    expect(card("Cimentación y estructura").getByText("Fin previsto superado · +2 d")).toBeInTheDocument();
    expect(card("Pinturas y varios").queryByText(/previsto superado/)).not.toBeInTheDocument();
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
    // Once the draft exists, its editor opens.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar"));
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
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar"));
  });

  it("can copy another project's plan", async () => {
    renderScreen({ planning: emptyPlanning });
    await userEvent.click(screen.getByRole("radio", { name: /Copiar de otra obra/ }));
    expect(screen.getByLabelText("Obra")).toHaveValue("p-2");
    await userEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(actions.createPlanningDraftAction).toHaveBeenCalledWith("p-1", expect.objectContaining({ from: "project", projectId: "p-2" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/obra/planificacion/editar"));
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
