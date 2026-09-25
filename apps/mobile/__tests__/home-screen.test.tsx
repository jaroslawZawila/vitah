import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, ScrollView } from "react-native";
import HomeScreen, { greetingKey } from "../app/(app)/index";
import { api, type Project } from "../lib/api";
import { PhotosProvider } from "../lib/use-photos";
import { ProjectProvider } from "../lib/use-project";

const mockSignOut = jest.fn();
const mockNavigate = jest.fn();
let mockUser: { name: string | null } | null = { name: "Ana García" };

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: mockUser, signOut: mockSignOut }),
}));
jest.mock("../lib/api", () => ({
  api: { getProject: jest.fn(), listPhotos: jest.fn(), photoUrl: (id: string) => `/photos/${id}` },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }) }));

const getProject = jest.mocked(api.getProject);
const listPhotos = jest.mocked(api.listPhotos);

const project: Project = {
  id: "p1",
  ref: "VTH-2026-014",
  address: "Calle del Sol 5, Santander",
  startDate: "2026-03-10",
  completionDate: "2027-01-15",
};

const photo = (id: string, uploadedAt: string, caption: string | null = null) => ({
  id,
  caption,
  sizeBytes: 1,
  uploadedAt,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { name: "Ana García" };
  getProject.mockResolvedValue({ ok: true, data: { project } });
  listPhotos.mockResolvedValue({ ok: true, data: { photos: [] } });
  // 25 Sept 2026, 16:00 in Madrid.
  jest.useFakeTimers({ now: new Date("2026-09-25T14:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
});

afterEach(() => jest.useRealTimers());

/** Home inside the tabs' data providers. */
const Home = () => (
  <ProjectProvider>
    <PhotosProvider>
      <HomeScreen />
    </PhotosProvider>
  </ProjectProvider>
);

describe("HomeScreen", () => {
  it("greets the client and shows the project card", async () => {
    render(<Home />);

    expect(screen.getByLabelText("Cargando tu proyecto")).toBeOnTheScreen();
    expect(await screen.findByText("VTH-2026-014")).toBeOnTheScreen();
    expect(screen.getByText("Ana, tu casa avanza.")).toBeOnTheScreen();
    expect(screen.getByText("Calle del Sol 5, Santander")).toBeOnTheScreen();
    expect(screen.getByText("10 mar 2026")).toBeOnTheScreen();
    expect(screen.getByText("15 ene 2027")).toBeOnTheScreen();
  });

  it("counts the days to delivery", async () => {
    render(<Home />);

    // 25 Sept 2026 → 15 Jan 2027.
    expect(await screen.findByText("112")).toBeOnTheScreen();
    expect(screen.getByText("días para la entrega")).toBeOnTheScreen();
  });

  it("leaves out the countdown once the date has passed or isn't set", async () => {
    getProject.mockResolvedValue({
      ok: true,
      data: { project: { ...project, startDate: null, completionDate: null } },
    });
    render(<Home />);

    expect(await screen.findAllByText("Por confirmar")).toHaveLength(2);
    expect(screen.queryByText("días para la entrega")).toBeNull();
  });

  it("shows the latest week of photos and opens Fotos", async () => {
    listPhotos.mockResolvedValue({
      ok: true,
      data: {
        photos: [
          photo("a", "2026-09-24T10:00:00Z", "Cubierta terminada"),
          photo("b", "2026-09-22T10:00:00Z"),
          photo("c", "2026-09-08T10:00:00Z"),
        ],
      },
    });
    render(<Home />);

    expect(await screen.findByText("Cubierta terminada")).toBeOnTheScreen();
    expect(screen.getByText(/^24 sept?\.? · 2 fotos$/)).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("link", { name: "Ver fotos" }));
    expect(mockNavigate).toHaveBeenCalledWith("/photos");
  });

  it("hides the latest update without photos", async () => {
    render(<Home />);

    await screen.findByText("VTH-2026-014");
    expect(screen.queryByText("Última actualización")).toBeNull();
  });

  it("opens Documentos and Ajustes, and says Garantía and Contactar are coming", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<Home />);
    await screen.findByText("VTH-2026-014");

    fireEvent.press(screen.getByRole("button", { name: "Documentos" }));
    fireEvent.press(screen.getByRole("button", { name: "Ajustes" }));
    expect(mockNavigate.mock.calls).toEqual([["/documents"], ["/profile"]]);

    fireEvent.press(screen.getByRole("button", { name: "Garantía" }));
    fireEvent.press(screen.getByRole("button", { name: "Contactar" }));
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledWith("Próximamente", expect.any(String));
  });

  it("explains when no project is assigned yet", async () => {
    getProject.mockResolvedValue({ ok: true, data: { project: null } });
    render(<Home />);

    expect(await screen.findByText("Hola, Ana")).toBeOnTheScreen();
    expect(screen.getByText(/Todavía no tienes un proyecto asignado/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Documentos" })).toBeNull();
  });

  it("offers a retry when the first load fails", async () => {
    getProject.mockResolvedValueOnce({ ok: false, error: "network_error" });
    render(<Home />);

    fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("VTH-2026-014")).toBeOnTheScreen();
  });

  it("keeps the project visible when a refresh fails", async () => {
    const view = render(<Home />);
    await screen.findByText("VTH-2026-014");
    getProject.mockResolvedValueOnce({ ok: false, error: "network_error" });

    const scroll = view.UNSAFE_getByType(ScrollView);
    await act(async () => scroll.props.refreshControl.props.onRefresh());

    expect(await screen.findByRole("alert")).toHaveTextContent(/No se ha podido actualizar/);
    expect(screen.getByText("VTH-2026-014")).toBeOnTheScreen();
  });

  it("signs out when the session is rejected", async () => {
    getProject.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<Home />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});

describe("greetingKey", () => {
  it.each([
    [8, "home.greeting.morning"],
    [12, "home.greeting.afternoon"],
    [19, "home.greeting.afternoon"],
    [20, "home.greeting.evening"],
  ])("%i h → %s", (hour, key) => {
    expect(greetingKey(hour)).toBe(key);
  });
});
