import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { api, type Project } from "../lib/api";
import { offlineSession, readOffline, writeOffline } from "../lib/offline-cache";
import { ProjectProvider, useProject } from "../lib/use-project";
import { disk } from "../test-utils/expo-file-system";

jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));
const mockAuth = { token: "tok", user: { id: "u1" }, signOut: jest.fn() };
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
jest.mock("../lib/api", () => ({ api: { listProjects: jest.fn() } }));

const listProjects = jest.mocked(api.listProjects);

const home = (id: string): Project => ({
  id,
  ref: `VTH-${id}`,
  address: `Calle ${id}, Santander`,
  startDate: "2026-03-10",
  completionDate: "2027-01-15",
  handedOver: false,
  progressPct: 40,
});

const wrapper = ({ children }: { children: ReactNode }) => <ProjectProvider>{children}</ProjectProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  disk.clear();
});

describe("ProjectProvider offline", () => {
  it("opens on the stored list of homes when there is no connection", async () => {
    writeOffline({ userId: "u1", name: "projects" }, { projects: [home("a"), home("b")] }, offlineSession());
    listProjects.mockResolvedValue({ ok: false, error: "network_error" });

    const { result } = renderHook(() => useProject(), { wrapper });

    await waitFor(() => expect(result.current.project?.id).toBe("a"));
    expect(result.current.projects).toHaveLength(2);
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.updatedAt).toBeDefined();
  });

  it("drops what is kept for a home the list no longer has, keeps the others and other clients'", async () => {
    writeOffline({ userId: "u1", name: "obra", projectId: "a" }, "obra a", offlineSession());
    writeOffline({ userId: "u1", name: "photos", projectId: "gone" }, "photos gone", offlineSession());
    writeOffline({ userId: "u2", name: "obra", projectId: "gone" }, "someone else's", offlineSession());
    listProjects.mockResolvedValue({ ok: true, data: { projects: [home("a")] } });

    const { result } = renderHook(() => useProject(), { wrapper });
    await waitFor(() => expect(result.current.project?.id).toBe("a"));
    await act(async () => {});

    expect((await readOffline({ userId: "u1", name: "obra", projectId: "a" }))?.data).toBe("obra a");
    expect(await readOffline({ userId: "u1", name: "photos", projectId: "gone" })).toBeNull();
    expect((await readOffline({ userId: "u2", name: "obra", projectId: "gone" }))?.data).toBe("someone else's");
    expect((await readOffline({ userId: "u1", name: "projects" }))?.data).toEqual({ projects: [home("a")] });
  });

  it("does not drop anything because the list could not be loaded", async () => {
    writeOffline({ userId: "u1", name: "obra", projectId: "a" }, "obra a", offlineSession());
    listProjects.mockResolvedValue({ ok: false, error: "network_error" });

    const { result } = renderHook(() => useProject(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(true));

    expect((await readOffline({ userId: "u1", name: "obra", projectId: "a" }))?.data).toBe("obra a");
  });
});
