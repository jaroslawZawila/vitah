// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/es.json";
import type { StepProps, WizardStep } from "../../components/wizard/types";
import type { ProjectDraft, ProjectFlowOptions } from "./draft";
import NewProjectScreen from "./NewProjectScreen";
import { PROJECT_STEPS } from "./steps";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../actions/projects", () => ({ createProject: vi.fn() }));
const { createProject } = await import("../../../actions/projects");

const ana = { id: "client-1", name: "Ana García", email: "ana@example.com" };
const luis = { id: "client-2", name: null, email: "luis@example.com" };

/** A manager: no client step. */
const staffOptions: ProjectFlowOptions = { canAssignClient: false, clients: [] };
const adminOptions: ProjectFlowOptions = { canAssignClient: true, clients: [ana, luis] };

function renderScreen(options = staffOptions, allSteps = PROJECT_STEPS) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <NewProjectScreen options={options} allSteps={allSteps} />
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
      clientId: "",
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
    const StyleStep = ({ draft, onChange }: StepProps<Draft, ProjectFlowOptions>) => (
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
    const styleStep: WizardStep<Draft, ProjectFlowOptions> = {
      id: "style",
      titleKey: "review", // any existing title key works for the test
      Component: StyleStep,
      Summary: StyleSummary,
      isComplete: (draft) => Boolean(draft.style),
    };
    vi.mocked(createProject).mockResolvedValue({ success: true, id: "new-id" });
    renderScreen(staffOptions, [...PROJECT_STEPS, styleStep] as typeof PROJECT_STEPS);

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

describe("NewProjectScreen client step", () => {
  it("lets an admin pick a client and creates the project with them", async () => {
    vi.mocked(createProject).mockResolvedValue({ success: true, id: "new-id" });
    renderScreen(adminOptions);

    await fillDetails();
    await next();
    expect(screen.getByText("Paso 2 de 3 · Cliente")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Sin cliente por ahora/ })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: /Ana García/ }));
    await next();

    expect(screen.getByText("Ana García (ana@example.com)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-1" })),
    );
  });

  it("allows creating without a client", async () => {
    vi.mocked(createProject).mockResolvedValue({ success: true, id: "new-id" });
    renderScreen(adminOptions);

    await fillDetails();
    await next();
    await next();

    expect(screen.getByText("Sin cliente por ahora")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ clientId: "" })),
    );
  });

  it("returns to the client step when the client was taken meanwhile", async () => {
    vi.mocked(createProject).mockResolvedValue({ error: "client_has_project" });
    renderScreen(adminOptions);
    await fillDetails();
    await next();
    await userEvent.click(screen.getByRole("radio", { name: /luis@example.com/ }));
    await next();

    await userEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ya está asignado a otro proyecto");
    expect(screen.getByText("Paso 2 de 3 · Cliente")).toBeInTheDocument();
  });

  it("explains when there are no free clients", async () => {
    renderScreen({ canAssignClient: true, clients: [] });
    await fillDetails();
    await next();

    expect(screen.getByText(/No hay clientes libres/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Sin cliente por ahora/ })).toBeChecked();
  });

  it("filters a long client list", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`,
      name: `Cliente ${i}`,
      email: `c${i}@example.com`,
    }));
    renderScreen({ canAssignClient: true, clients: many });
    await fillDetails();
    await next();

    await userEvent.type(screen.getByLabelText("Buscar cliente"), "c7@");

    expect(screen.getByRole("radio", { name: /Cliente 7/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Cliente 1/ })).not.toBeInTheDocument();
  });

  it("is hidden from non-admins", async () => {
    renderScreen(staffOptions);
    await fillDetails();
    await next();

    expect(screen.getByText("Paso 2 de 2 · Revisión")).toBeInTheDocument();
    expect(screen.queryByText("Cliente")).not.toBeInTheDocument();
  });
});
