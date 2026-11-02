// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import { obra } from "../../../../test/obra-fixture";
import ProjectStages from "./ProjectStages";

vi.mock("../../../actions/obra", () => ({ setObraStageAction: vi.fn() }));
const actions = await import("../../../actions/obra");

function renderStages(canManage = true) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <ProjectStages projectId="p-1" obra={obra} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(actions.setObraStageAction).mockReset().mockResolvedValue({ success: true }));

describe("ProjectStages", () => {
  it("shows the 8 stages and where the project is", () => {
    renderStages();
    const steps = within(screen.getByRole("list", { name: "Proceso" }));
    expect(steps.getAllByRole("listitem")).toHaveLength(8);
    expect(steps.getByText("6 · Ejecución de obra").closest("li")).toHaveAttribute("aria-current", "step");
    expect(steps.getByText("Rev.3 aceptada · 448.205,03 €")).toBeInTheDocument();
  });

  it("says since when the stage moved on its own, and what moves it next", () => {
    renderStages();
    expect(
      screen.getByText(
        "Desde el 6 jul 2026: primer capítulo iniciado en Avance · Pasa sola a Recepción y entrega con: todos los capítulos terminados",
      ),
    ).toBeInTheDocument();
  });

  it("names only what moves it next when the stage was set by hand", () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
        <ProjectStages projectId="p-1" obra={{ ...obra, stage: 7 }} canManage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Pasa sola a Garantía con: H9 pagado")).toBeInTheDocument();
  });

  it("promises nothing when what moves it next is already in (the stage set back by hand)", () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
        <ProjectStages projectId="p-1" obra={{ ...obra, stage: 4 }} canManage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Desde el 12 jun 2026: revisión aceptada")).toBeInTheDocument();
    expect(screen.queryByText(/Pasa sola/)).not.toBeInTheDocument();
  });

  it("dates the works from their actual start, not the planned one", () => {
    renderStages();
    const works = screen.getByText("6 · Ejecución de obra").closest("li")!;
    expect(within(works).getByText("Desde el 6 jul 2026")).toBeInTheDocument();
  });

  it("moves the project to another stage", async () => {
    renderStages();
    await userEvent.click(screen.getByRole("button", { name: "Pasar a la etapa 7: Recepción y entrega" }));
    expect(actions.setObraStageAction).toHaveBeenCalledWith("p-1", 7);
  });

  it("shows why the stage didn't change", async () => {
    vi.mocked(actions.setObraStageAction).mockResolvedValue({ error: "invalid_stage" });
    renderStages();
    await userEvent.click(screen.getByRole("button", { name: "Pasar a la etapa 7: Recepción y entrega" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Etapa no válida.");
  });

  it("is read-only for viewers", () => {
    renderStages(false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
