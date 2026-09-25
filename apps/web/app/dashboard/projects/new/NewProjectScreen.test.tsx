// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import type { StepProps, WizardStep } from "../../components/wizard/types";
import type { ProjectDraft } from "./draft";
import NewProjectScreen from "./NewProjectScreen";
import { PROJECT_STEPS } from "./steps";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../actions/projects", () => ({ createProject: vi.fn() }));
const { createProject } = await import("../../../actions/projects");

function renderScreen(steps = PROJECT_STEPS) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <NewProjectScreen steps={steps} />
    </NextIntlClientProvider>,
  );
}

async function fillDetails() {
  await userEvent.type(screen.getByLabelText("Referencia"), "VTH-26-007");
  await userEvent.type(screen.getByLabelText("Dirección"), "Calle Mayor 1, Santander");
  await userEvent.type(screen.getByLabelText("Fecha de inicio"), "2026-10-01");
}

const next = () => userEvent.click(screen.getByRole("button", { name: "Siguiente" }));

beforeEach(() => {
  vi.mocked(createProject).mockReset();
  router.push.mockReset();
});

describe("NewProjectScreen", () => {
  it("walks from the details to the review and creates the project", async () => {
    vi.mocked(createProject).mockResolvedValue({ success: true, id: "new-id" });
    renderScreen();

    expect(screen.getByText("Paso 1 de 2 · Datos del proyecto")).toBeInTheDocument();
    await fillDetails();
    await next();

    expect(screen.getByText("Paso 2 de 2 · Revisión")).toBeInTheDocument();
    expect(screen.getByText("VTH-26-007")).toBeInTheDocument();
    expect(screen.getByText("1 de octubre de 2026")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/projects/new-id"));
    expect(createProject).toHaveBeenCalledWith({
      ref: "VTH-26-007",
      address: "Calle Mayor 1, Santander",
      startDate: "2026-10-01",
      completionDate: "",
    });
  });

  it("keeps the user on the details step until the required fields are filled", async () => {
    renderScreen();

    await next();

    expect(screen.getByText("Paso 1 de 2 · Datos del proyecto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revisión/ })).toBeDisabled();
  });

  it("goes back to edit from the review", async () => {
    renderScreen();
    await fillDetails();
    await next();

    await userEvent.click(screen.getByRole("button", { name: "Editar Datos del proyecto" }));

    expect(screen.getByLabelText("Referencia")).toHaveValue("VTH-26-007");
  });

  it("returns to the step that caused a server error", async () => {
    vi.mocked(createProject).mockResolvedValue({ error: "ref_exists" });
    renderScreen();
    await fillDetails();
    await next();

    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un proyecto con esa referencia.",
    );
    expect(screen.getByLabelText("Referencia")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a generic message for unexpected errors", async () => {
    vi.mocked(createProject).mockResolvedValue({ error: "something_else" });
    renderScreen();
    await fillDetails();
    await next();

    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido crear el proyecto");
  });

  it("runs any extra registered step before the review", async () => {
    // Stand-in for a future step such as "style": only the registry changes.
    type Draft = ProjectDraft & { style?: string };
    const StyleStep = ({ draft, onChange }: StepProps<Draft>) => (
      <label>
        Style
        <input
          required
          value={draft.style ?? ""}
          onChange={(e) => onChange({ style: e.target.value })}
        />
      </label>
    );
    const StyleSummary = ({ draft }: { draft: Draft }) => <p>Style: {draft.style}</p>;
    const styleStep: WizardStep<Draft> = {
      id: "style",
      titleKey: "review", // any existing title key works for the test
      Component: StyleStep,
      Summary: StyleSummary,
      isComplete: (draft) => Boolean(draft.style),
    };
    vi.mocked(createProject).mockResolvedValue({ success: true, id: "new-id" });
    renderScreen([...PROJECT_STEPS, styleStep] as typeof PROJECT_STEPS);

    await fillDetails();
    await next();
    expect(screen.getByText("Paso 2 de 3 · Revisión")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Style"), "nordic");
    await next();

    expect(screen.getByText("Style: nordic")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ style: "nordic" })),
    );
  });
});
