import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import ProjectScreen from "../app/(app)/index";
import { api, type Project } from "../lib/api";

const mockSignOut = jest.fn();
let mockUser: { name: string | null } | null = { name: "Ana García" };

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: mockUser, signOut: mockSignOut }),
}));
jest.mock("../lib/api", () => ({ api: { getProject: jest.fn() } }));
// Render the header's right button inline so it can be pressed.
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: { title: string; headerRight: () => ReactNode } }) => (
      <>{options.headerRight()}</>
    ),
  },
}));

const getProject = jest.mocked(api.getProject);

const project: Project = {
  id: "p1",
  ref: "VTH-2026-014",
  address: "Calle del Sol 5, Santander",
  startDate: "2026-03-01",
  completionDate: "2026-11-15",
};

beforeEach(() => {
  getProject.mockReset();
  mockSignOut.mockReset();
  mockUser = { name: "Ana García" };
});

describe("ProjectScreen", () => {
  it("shows a spinner, then the project details", async () => {
    getProject.mockResolvedValue({ ok: true, data: { project } });
    render(<ProjectScreen />);

    expect(screen.getByLabelText("Cargando tu proyecto")).toBeOnTheScreen();

    expect(await screen.findByText("VTH-2026-014")).toBeOnTheScreen();
    expect(getProject).toHaveBeenCalledWith("tok");
    expect(screen.getByText("Hola, Ana")).toBeOnTheScreen();
    expect(screen.getByText("Calle del Sol 5, Santander")).toBeOnTheScreen();
    expect(screen.getByText("1 de marzo de 2026")).toBeOnTheScreen();
    expect(screen.getByText("15 de noviembre de 2026")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Cargando tu proyecto")).not.toBeOnTheScreen();
  });

  it("shows pending dates as to be confirmed", async () => {
    getProject.mockResolvedValue({
      ok: true,
      data: { project: { ...project, startDate: null, completionDate: null } },
    });
    render(<ProjectScreen />);

    expect(await screen.findAllByText("Por confirmar")).toHaveLength(2);
  });

  it("explains when no project is assigned yet", async () => {
    mockUser = { name: null };
    getProject.mockResolvedValue({ ok: true, data: { project: null } });
    render(<ProjectScreen />);

    expect(await screen.findByText(/Todavía no tienes un proyecto asignado/)).toBeOnTheScreen();
    expect(screen.getByText("Hola")).toBeOnTheScreen();
  });

  it("offers a retry when the first load fails", async () => {
    getProject.mockResolvedValueOnce({ ok: false, error: "network_error" });
    render(<ProjectScreen />);

    const retry = await screen.findByRole("button", { name: "Reintentar" });
    getProject.mockResolvedValueOnce({ ok: true, data: { project } });
    fireEvent.press(retry);

    expect(await screen.findByText("VTH-2026-014")).toBeOnTheScreen();
    expect(getProject).toHaveBeenCalledTimes(2);
  });

  it("keeps the project visible when a refresh fails", async () => {
    getProject.mockResolvedValueOnce({ ok: true, data: { project } });
    const { UNSAFE_getByProps } = render(<ProjectScreen />);
    await screen.findByText("VTH-2026-014");

    getProject.mockResolvedValueOnce({ ok: false, error: "server_error" });
    await act(async () => UNSAFE_getByProps({ refreshing: false }).props.onRefresh());

    expect(await screen.findByText(/No se ha podido actualizar/)).toBeOnTheScreen();
    expect(screen.getByText("VTH-2026-014")).toBeOnTheScreen();
  });

  it("signs out when the session is rejected", async () => {
    getProject.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<ProjectScreen />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it("signs out from the header", async () => {
    getProject.mockResolvedValue({ ok: true, data: { project } });
    render(<ProjectScreen />);
    await screen.findByText("VTH-2026-014");

    fireEvent.press(screen.getByRole("button", { name: "Salir" }));

    expect(mockSignOut).toHaveBeenCalled();
  });
});
