import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { api, type Project } from "../lib/api";
import { pickProject, ProjectProvider, useProject } from "../lib/use-project";
import { secureStore } from "../test-utils/secure-store";

const mockSignOut = jest.fn();
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", signOut: mockSignOut }) }));
jest.mock("../lib/api", () => ({ api: { listProjects: jest.fn() } }));

const listProjects = jest.mocked(api.listProjects);

const home = (id: string, handedOver = false): Project => ({
  id,
  ref: `VTH-${id}`,
  address: `Calle ${id}, Santander`,
  startDate: "2026-03-10",
  completionDate: "2027-01-15",
  handedOver,
  progressPct: handedOver ? null : 40,
});

const wrapper = ({ children }: { children: ReactNode }) => <ProjectProvider>{children}</ProjectProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
  listProjects.mockResolvedValue({ ok: true, data: { projects: [home("a"), home("b", true)] } });
});

describe("pickProject", () => {
  it("picks the chosen home while it is theirs, else the first (the default)", () => {
    const homes = [home("a"), home("b")];

    expect(pickProject(homes, "b")?.id).toBe("b");
    expect(pickProject(homes, "gone")?.id).toBe("a");
    expect(pickProject(homes, null)?.id).toBe("a");
    expect(pickProject([], "a")).toBeNull();
  });
});

describe("ProjectProvider", () => {
  it("shows the default home, then the one chosen, remembered on the phone", async () => {
    const { result } = renderHook(useProject, { wrapper });
    await waitFor(() => expect(result.current.project?.id).toBe("a"));
    expect(result.current.projectId).toBe("a");
    expect(result.current.projects?.map((p) => p.id)).toEqual(["a", "b"]);

    act(() => result.current.select("b"));

    expect(result.current.project?.id).toBe("b");
    expect(secureStore.get("vitah_project")).toBe("b");
    await waitFor(() => expect(secureStore.get("vitah_project_shown")).toBe("b"));
  });

  it("shows a notification's home without remembering it", async () => {
    secureStore.set("vitah_project", "a");
    const { result } = renderHook(useProject, { wrapper });
    await waitFor(() => expect(result.current.project?.id).toBe("a"));

    act(() => result.current.select("b", false));

    expect(result.current.project?.id).toBe("b");
    expect(secureStore.get("vitah_project")).toBe("a");
  });

  it("keeps a home picked before the phone's choice was read (a notification opening the app)", async () => {
    secureStore.set("vitah_project", "a");
    const { result } = renderHook(useProject, { wrapper });

    act(() => result.current.select("b", false));

    await waitFor(() => expect(result.current.project?.id).toBe("b"));
  });

  it("starts loading with the home chosen on the phone, before the list arrives", async () => {
    secureStore.set("vitah_project", "b");
    listProjects.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(useProject, { wrapper });

    await waitFor(() => expect(result.current.projectId).toBe("b"));
    expect(result.current.project).toBeUndefined();
  });

  it("knows no home to load until the list has loaded", async () => {
    listProjects.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(useProject, { wrapper });

    expect(result.current.project).toBeUndefined();
    expect(result.current.projectId).toBeUndefined();
    await act(async () => {});
  });

  it("is null without homes", async () => {
    listProjects.mockResolvedValue({ ok: true, data: { projects: [] } });
    const { result } = renderHook(useProject, { wrapper });

    await waitFor(() => expect(result.current.project).toBeNull());
    expect(result.current.projectId).toBeNull();
  });

  it("falls back to the home last shown when the list can't load (offline)", async () => {
    secureStore.set("vitah_project_shown", "b");
    listProjects.mockResolvedValue({ ok: false, error: "network_error" });
    const { result } = renderHook(useProject, { wrapper });

    await waitFor(() => expect(result.current.projectId).toBe("b"));
    expect(result.current.project).toBeUndefined();
    expect(result.current.error).toBe(true);
  });
});
