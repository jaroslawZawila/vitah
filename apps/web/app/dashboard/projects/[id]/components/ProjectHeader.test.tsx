// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import type { ProjectDetail } from "../../../../actions/projects";
import ProjectHeader from "./ProjectHeader";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../actions/projects", () => ({
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));
const { updateProject, deleteProject } =
  await import("../../../../actions/projects");

const project: ProjectDetail = {
  id: "project-1",
  tenantId: "tenant-1",
  ref: "VTH-2026-014",
  address: "Calle Mayor 1, Santander",
  startDate: new Date("2026-03-01T00:00:00Z"),
  completionDate: null,
  clientUserId: null,
  client: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function renderHeader(overrides: Partial<ProjectDetail> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <ProjectHeader project={{ ...project, ...overrides }} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(updateProject).mockReset();
  vi.mocked(deleteProject).mockReset();
  router.refresh.mockReset();
  router.push.mockReset();
});

describe("ProjectHeader", () => {
  it("shows the ref, address and dates, with unset dates to be confirmed", () => {
    renderHeader();

    expect(screen.getByText("VTH-2026-014")).toBeInTheDocument();
    expect(screen.getByText("Calle Mayor 1, Santander")).toBeInTheDocument();
    expect(screen.getByText("1 de marzo de 2026")).toBeInTheDocument();
    expect(screen.getByText("Por confirmar")).toBeInTheDocument();
  });

  it("edits the address together with the dates", async () => {
    vi.mocked(updateProject).mockResolvedValue({ success: true });
    renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    const address = screen.getByLabelText("Dirección");
    expect(address).toHaveValue("Calle Mayor 1, Santander");
    expect(screen.getByLabelText("Fecha de inicio")).toHaveValue("2026-03-01");
    await userEvent.clear(address);
    await userEvent.type(address, "Calle del Sol 5, Santander");
    await userEvent.type(
      screen.getByLabelText("Fecha de finalización"),
      "2026-11-15",
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith("project-1", {
        address: "Calle del Sol 5, Santander",
        startDate: "2026-03-01",
        completionDate: "2026-11-15",
      }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByLabelText("Dirección")).not.toBeInTheDocument();
  });

  it("shows a save error and stays in edit mode", async () => {
    vi.mocked(updateProject).mockResolvedValue({ error: "missing_fields" });
    renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.clear(screen.getByLabelText("Dirección"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La dirección es obligatoria.",
    );
    expect(screen.getByLabelText("Dirección")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("deletes the project after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar proyecto" }),
    );

    await waitFor(() =>
      expect(deleteProject).toHaveBeenCalledWith("project-1"),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/dashboard/projects"),
    );
  });

  it("does not delete when the confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderHeader();

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Eliminar proyecto" }),
    );

    expect(deleteProject).not.toHaveBeenCalled();
  });
});
