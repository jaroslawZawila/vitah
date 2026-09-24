// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import ProjectsListClient from "./ProjectsListClient";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../actions/projects", () => ({ createProject: vi.fn() }));
const { createProject } = await import("../../actions/projects");

const projects = [
  {
    id: "p1",
    ref: "VTH-1",
    address: "Calle Mayor 1, Santander",
    startDate: new Date("2026-03-01T00:00:00Z"),
    completionDate: null,
    client: { id: "c1", name: "Ana García", email: "ana@example.com" },
  },
  {
    id: "p2",
    ref: "VTH-2",
    address: "Calle del Sol 5, Santander",
    startDate: null,
    completionDate: null,
    client: null,
  },
];

function renderList(list = projects) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <ProjectsListClient projects={list} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(createProject).mockReset();
  router.push.mockReset();
});

describe("ProjectsListClient", () => {
  it("lists projects with their address, client and dates", () => {
    renderList();

    expect(screen.getByText("Todos (2)")).toBeInTheDocument();
    const [, first, second] = screen.getAllByRole("row");
    expect(within(first!).getByText("VTH-1")).toBeInTheDocument();
    expect(
      within(first!).getByText("Calle Mayor 1, Santander"),
    ).toBeInTheDocument();
    expect(within(first!).getByText("Ana García")).toBeInTheDocument();
    expect(within(first!).getByText("1 mar 2026")).toBeInTheDocument();
    expect(within(first!).getByRole("link", { name: "Ver" })).toHaveAttribute(
      "href",
      "/dashboard/projects/p1",
    );
    expect(
      within(second!).getByText("Sin acceso a la app"),
    ).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderList([]);

    expect(screen.getByText("Todavía no hay proyectos.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("creates a project and opens it", async () => {
    vi.mocked(createProject).mockResolvedValue({ success: true, id: "new-id" });
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: "+ Nuevo Proyecto" }),
    );
    await userEvent.type(screen.getByLabelText("Referencia"), "VTH-3");
    await userEvent.type(screen.getByLabelText("Dirección"), "Calle 3");
    await userEvent.type(
      screen.getByLabelText("Fecha de inicio"),
      "2026-05-01",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Crear proyecto" }),
    );

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/dashboard/projects/new-id"),
    );
    const data = vi.mocked(createProject).mock.calls[0]![1];
    expect(Object.fromEntries(data)).toEqual({
      ref: "VTH-3",
      address: "Calle 3",
      startDate: "2026-05-01",
      completionDate: "",
    });
  });

  it("shows create errors", async () => {
    vi.mocked(createProject).mockResolvedValue({ error: "ref_exists" });
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: "+ Nuevo Proyecto" }),
    );
    await userEvent.type(screen.getByLabelText("Referencia"), "VTH-1");
    await userEvent.type(screen.getByLabelText("Dirección"), "Calle 1");
    await userEvent.click(
      screen.getByRole("button", { name: "Crear proyecto" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un proyecto con esa referencia.",
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});
