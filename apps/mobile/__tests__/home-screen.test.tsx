import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, ScrollView } from "react-native";
import HomeScreen, { greetingKey } from "../app/(app)/(tabs)/index";
import { api, type Project } from "../lib/api";
import { PhotosProvider } from "../lib/use-photos";
import { ObraProvider } from "../lib/use-obra";
import { ProjectProvider } from "../lib/use-project";
import { obra } from "../test-utils/obra-fixture";
import { secureStore } from "../test-utils/secure-store";

const mockSignOut = jest.fn();
const mockNavigate = jest.fn();
let mockUser: { name: string | null } | null = { name: "Ana García" };

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: mockUser, signOut: mockSignOut }),
}));
jest.mock("../lib/api", () => ({
  api: {
    listProjects: jest.fn(),
    listPhotos: jest.fn(),
    getObra: jest.fn(),
    photoUrl: (id: string) => `/photos/${id}`,
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: mockNavigate }) }));

const listProjects = jest.mocked(api.listProjects);
const listPhotos = jest.mocked(api.listPhotos);
const getObra = jest.mocked(api.getObra);

const project: Project = {
  id: "p1",
  ref: "VTH-2026-014",
  address: "Calle del Sol 5, Santander",
  startDate: "2026-03-10",
  completionDate: "2027-01-15",
  handedOver: false,
  progressPct: 40,
};

const photo = (id: string, uploadedAt: string, caption: string | null = null) => ({
  id,
  caption,
  sizeBytes: 1,
  uploadedAt,
});

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
  mockUser = { name: "Ana García" };
  listProjects.mockResolvedValue({ ok: true, data: { projects: [project] } });
  listPhotos.mockResolvedValue({ ok: true, data: { photos: [] } });
  getObra.mockResolvedValue({ ok: true, data: { obra: null } });
  // 25 Sept 2026, 16:00 in Madrid.
  jest.useFakeTimers({ now: new Date("2026-09-25T14:00:00Z"), doNotFake: ["nextTick", "setImmediate"] });
});

afterEach(() => jest.useRealTimers());

/** Home inside the tabs' data providers. */
const Home = () => (
  <ProjectProvider>
    <PhotosProvider>
      <ObraProvider>
        <HomeScreen />
      </ObraProvider>
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

  it("shows the construction progress and opens the Obra tab", async () => {
    getObra.mockResolvedValue({ ok: true, data: { obra } });
    render(<Home />);

    expect(await screen.findByText("52%")).toBeOnTheScreen();
    expect(screen.getByText("112")).toBeOnTheScreen();
    expect(screen.getByText("Fase 3 de 4 · Envolvente estanca")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("link", { name: "Ver avance detallado" }));
    expect(mockNavigate).toHaveBeenCalledWith("/obra");
  });

  it("leaves out the countdown once the date has passed or isn't set", async () => {
    listProjects.mockResolvedValue({
      ok: true,
      data: { projects: [{ ...project, startDate: null, completionDate: null }] },
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
    listProjects.mockResolvedValue({ ok: true, data: { projects: [] } });
    render(<Home />);

    expect(await screen.findByText("Hola, Ana")).toBeOnTheScreen();
    expect(screen.getByText(/Todavía no tienes un proyecto asignado/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Documentos" })).toBeNull();
  });

  it("offers a retry when the first load fails", async () => {
    listProjects.mockResolvedValueOnce({ ok: false, error: "network_error" });
    render(<Home />);

    fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("VTH-2026-014")).toBeOnTheScreen();
  });

  it("keeps the project visible when a refresh fails", async () => {
    const view = render(<Home />);
    await screen.findByText("VTH-2026-014");
    listProjects.mockResolvedValueOnce({ ok: false, error: "network_error" });

    const scroll = view.UNSAFE_getByType(ScrollView);
    await act(async () => scroll.props.refreshControl.props.onRefresh());

    expect(await screen.findByRole("alert")).toHaveTextContent(/No se ha podido actualizar/);
    expect(screen.getByText("VTH-2026-014")).toBeOnTheScreen();
  });

  it("signs out when the session is rejected", async () => {
    listProjects.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<Home />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});

describe("HomeScreen with several homes", () => {
  const older: Project = {
    id: "p0",
    ref: "VTH-24-007",
    address: "Barrio La Sierra 4, 39120 Liencres",
    startDate: "2024-02-01",
    completionDate: "2025-06-12",
    handedOver: true,
    progressPct: null,
  };

  beforeEach(() => {
    listProjects.mockResolvedValue({ ok: true, data: { projects: [project, older] } });
  });

  it("opens on the first (the newest open one) and lists the other below", async () => {
    render(<Home />);

    expect(await screen.findByText("VTH-2026-014")).toBeOnTheScreen();
    expect(screen.getByText("2 viviendas")).toBeOnTheScreen();
    expect(screen.getByText("Tu otra vivienda")).toBeOnTheScreen();
    expect(screen.getByText("Barrio La Sierra 4")).toBeOnTheScreen();
    expect(screen.getByText(/^Entregada · jun\.? 2025$/)).toBeOnTheScreen();
    await waitFor(() => expect(listPhotos).toHaveBeenCalledWith("tok", "p1"));
    expect(getObra).toHaveBeenCalledWith("tok", "p1");
  });

  it("shows the other home when tapped, and remembers it", async () => {
    render(<Home />);
    await screen.findByText("Tu otra vivienda");

    fireEvent.press(screen.getByText("Barrio La Sierra 4"));

    expect(await screen.findByText("Barrio La Sierra 4, 39120 Liencres")).toBeOnTheScreen();
    expect(screen.getByText("Calle del Sol 5")).toBeOnTheScreen();
    await waitFor(() => expect(listPhotos).toHaveBeenLastCalledWith("tok", "p0"));
    expect(getObra).toHaveBeenLastCalledWith("tok", "p0");
    expect(secureStore.get("vitah_project")).toBe("p0");
  });

  it("switches from the pill's sheet", async () => {
    render(<Home />);
    fireEvent.press(await screen.findByRole("button", { name: "2 viviendas. Cambiar de vivienda" }));

    expect(screen.getByText("Mis viviendas")).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: /VTH-2026-014/ })).toBeSelected();
    fireEvent.press(screen.getByRole("radio", { name: /VTH-24-007/ }));

    expect(await screen.findByText("Barrio La Sierra 4, 39120 Liencres")).toBeOnTheScreen();
    expect(screen.queryByText("Mis viviendas")).toBeNull();
  });

  it("opens on the home chosen before, while it is still theirs", async () => {
    secureStore.set("vitah_project", "p0");
    const { unmount } = render(<Home />);
    expect(await screen.findByText("Barrio La Sierra 4, 39120 Liencres")).toBeOnTheScreen();
    unmount();

    listProjects.mockResolvedValue({ ok: true, data: { projects: [project] } });
    render(<Home />);
    expect(await screen.findByText("Calle del Sol 5, Santander")).toBeOnTheScreen();
    expect(screen.queryByText("Tu otra vivienda")).toBeNull();
  });
});

describe("HomeScreen with one home", () => {
  it("shows no switch and no other homes", async () => {
    render(<Home />);
    await screen.findByText("VTH-2026-014");

    expect(screen.queryByText(/viviendas?$/)).toBeNull();
    expect(screen.queryByText("Tu otra vivienda")).toBeNull();
    await waitFor(() => expect(listPhotos).toHaveBeenCalledWith("tok", "p1"));
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
