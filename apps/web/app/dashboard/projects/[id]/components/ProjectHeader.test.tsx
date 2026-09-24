// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import type { ProjectWithRelations } from "../../../../actions/projects";
import ProjectHeader from "./ProjectHeader";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../../../actions/projects", () => ({
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));
const { updateProject } = await import("../../../../actions/projects");

const project = {
  id: "project-1",
  ref: "VTH-2026-014",
  clientName: "Familia García",
  areaM2: 120,
  type: "unifamiliar",
  phase: "construction",
  progressPct: 40,
  budgetTotal: 100_000_00,
  location: "Calle Mayor 1, Santander",
  qualityLevel: "standard",
  constructionWeekCurrent: 4,
  constructionWeekTotal: 20,
  startDate: new Date("2026-03-01T00:00:00Z"),
  expectedDeliveryDate: new Date("2026-11-15T00:00:00Z"),
  advisor: null,
  invoices: [],
} as unknown as ProjectWithRelations;

describe("ProjectHeader editing", () => {
  it("edits the address together with the dates", async () => {
    render(
      <NextIntlClientProvider locale="es" messages={messages}>
        <ProjectHeader project={project} />
      </NextIntlClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    const address = screen.getByLabelText("Dirección");
    expect(address).toHaveValue("Calle Mayor 1, Santander");
    await userEvent.clear(address);
    await userEvent.type(address, "Calle del Sol 5, Santander");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          location: "Calle del Sol 5, Santander",
          startDate: "2026-03-01",
          expectedDeliveryDate: "2026-11-15",
        }),
      ),
    );
  });
});
