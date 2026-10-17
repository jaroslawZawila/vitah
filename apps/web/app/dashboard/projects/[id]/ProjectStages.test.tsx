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
