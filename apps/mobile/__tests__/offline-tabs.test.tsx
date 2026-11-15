import { render, screen } from "@testing-library/react-native";
import ObraScreen from "../app/(app)/(tabs)/obra";
import PhotosScreen from "../app/(app)/(tabs)/photos";
import { api, type Project } from "../lib/api";
import { offlineSession, writeOffline } from "../lib/offline-cache";
import { ObraProvider } from "../lib/use-obra";
import { PhotosProvider } from "../lib/use-photos";
import { ProjectProvider } from "../lib/use-project";
import { disk } from "../test-utils/expo-file-system";
import { obra } from "../test-utils/obra-fixture";

jest.mock("expo-file-system", () => require("../test-utils/expo-file-system"));
const mockAuth = { token: "tok", user: { id: "u1", name: "Ana" }, signOut: jest.fn() };
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
jest.mock("../lib/api", () => ({
  api: {
    listProjects: jest.fn(),
    getObra: jest.fn(),
    listPhotos: jest.fn(),
    photoUrl: (id: string, size: string) => `https://api.test/api/mobile/photos/${id}?size=${size}`,
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const project: Project = {
  id: "p1",
  ref: "VTH-26-001",
  address: "El Llordal, Castrillón",
  startDate: "2026-05-04",
  completionDate: "2027-02-05",
  handedOver: false,
  progressPct: 33,
};
const photo = { id: "ph1", caption: "Fachada sur", sizeBytes: 1024, uploadedAt: "2026-09-22T10:00:00.000Z" };
const savedAt = new Date("2026-11-14T09:30:00.000Z");

const Tabs = () => (
  <ProjectProvider>
    <PhotosProvider>
      <ObraProvider>
        <ObraScreen />
        <PhotosScreen />
      </ObraProvider>
    </PhotosProvider>
  </ProjectProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  disk.clear();
  jest.mocked(api.listProjects).mockResolvedValue({ ok: false, error: "network_error" });
  jest.mocked(api.getObra).mockResolvedValue({ ok: false, error: "network_error" });
  jest.mocked(api.listPhotos).mockResolvedValue({ ok: false, error: "network_error" });
});

describe("the tabs without a connection", () => {
  it("open on the stored obra and photos, with a note saying when the data is from", async () => {
    writeOffline({ userId: "u1", name: "projects" }, { projects: [project] }, offlineSession(), savedAt);
    writeOffline({ userId: "u1", name: "obra", projectId: "p1" }, { obra }, offlineSession(), savedAt);
    writeOffline({ userId: "u1", name: "photos", projectId: "p1" }, { photos: [photo] }, offlineSession(), savedAt);

    render(<Tabs />);

    expect(await screen.findByText("52%")).toBeOnTheScreen();
    expect(await screen.findByText("Fachada sur")).toBeOnTheScreen();
    expect((await screen.findAllByText(/^Sin conexión · datos del 14 nov\.?, 10:30$/)).length).toBe(2);
    expect(screen.queryByText(/No hemos podido cargar/)).toBeNull();
  });

  it("show no stored data of another client", async () => {
    writeOffline({ userId: "u2", name: "projects" }, { projects: [project] }, offlineSession(), savedAt);
    writeOffline({ userId: "u2", name: "obra", projectId: "p1" }, { obra }, offlineSession(), savedAt);

    render(<Tabs />);

    expect(await screen.findAllByText(/No hemos podido cargar/)).not.toHaveLength(0);
    expect(screen.queryByText("52%")).toBeNull();
    expect(screen.queryByText(/Sin conexión · datos/)).toBeNull();
  });
});
