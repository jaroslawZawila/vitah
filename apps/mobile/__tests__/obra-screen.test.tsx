import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import ObraScreen from "../app/(app)/(tabs)/obra";
import { api, type Project } from "../lib/api";
import { ObraProvider } from "../lib/use-obra";
import { PhotosProvider } from "../lib/use-photos";
import { ProjectProvider } from "../lib/use-project";
import { obra } from "../test-utils/obra-fixture";

const mockSignOut = jest.fn();
const mockPush = jest.fn();

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: { name: "Ana" }, signOut: mockSignOut }),
}));
jest.mock("../lib/api", () => ({ api: { getProject: jest.fn(), getObra: jest.fn(), listPhotos: jest.fn() } }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const getObra = jest.mocked(api.getObra);
const getProject = jest.mocked(api.getProject);

const project: Project = {
  id: "p1",
  ref: "VTH-26-001",
  address: "El Llordal, Castrillón",
  startDate: "2026-05-04",
  completionDate: "2027-02-05",
};

const Obra = () => (
  <ProjectProvider>
    <PhotosProvider>
      <ObraProvider>
        <ObraScreen />
      </ObraProvider>
    </PhotosProvider>
  </ProjectProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  getProject.mockResolvedValue({ ok: true, data: { project } });
  getObra.mockResolvedValue({ ok: true, data: { obra } });
  jest.mocked(api.listPhotos).mockResolvedValue({ ok: true, data: { photos: [] } });
});

describe("ObraScreen", () => {
  it("shows the progress, schedule, next payment and phases on one screen", async () => {
    render(<Obra />);

    expect(await screen.findByText("52%")).toBeOnTheScreen();
    expect(screen.getByText("VTH-26-001 · EL LLORDAL")).toBeOnTheScreen();
    expect(screen.getByText("21 de 40 · en plazo")).toBeOnTheScreen();
    expect(screen.getByText("5 feb 2027")).toBeOnTheScreen();
    expect(screen.getByText("Próximo pago · 73.953,83 € · 1 oct")).toBeOnTheScreen();
    expect(screen.getByText("Fases · 3 de 4")).toBeOnTheScreen();

    // Done phases show the month they closed; the current one its %.
    expect(screen.getByText("Proyecto y licencia")).toBeOnTheScreen();
    expect(screen.getByText("abr")).toBeOnTheScreen();
    expect(screen.getByText("69 %")).toBeOnTheScreen();
    // The last phase, still pending, shows the handover date.
    expect(screen.getByText("feb 2027")).toBeOnTheScreen();
  });

  it("opens a phase and the payments", async () => {
    render(<Obra />);

    fireEvent.press(await screen.findByRole("button", { name: /Envolvente estanca/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/obra/fase/[key]", params: { key: "H4" } });

    fireEvent.press(screen.getByRole("button", { name: /Próximo pago/ }));
    expect(mockPush).toHaveBeenCalledWith("/obra/pagos");
  });

  it("shows the days late instead of 'on schedule'", async () => {
    getObra.mockResolvedValue({ ok: true, data: { obra: { ...obra, term: { ...obra.term!, lateDays: 3 } } } });
    render(<Obra />);
    expect(await screen.findByText("21 de 40 · 3 días de retraso")).toBeOnTheScreen();
  });

  it("offers the payments when nothing is due", async () => {
    getObra.mockResolvedValue({ ok: true, data: { obra: { ...obra, hitos: obra.hitos.filter((h) => h.status !== "invoiced") } } });
    render(<Obra />);
    expect(await screen.findByText("Pagos · 53.784,60 € pagados sin IVA")).toBeOnTheScreen();
  });

  it("explains when the budget isn't ready and when there is no project", async () => {
    getObra.mockResolvedValue({ ok: true, data: { obra: { ...obra, phases: [], hitos: [] } } });
    const view = render(<Obra />);
    expect(await screen.findByText(/Estamos preparando el presupuesto/)).toBeOnTheScreen();
    view.unmount();

    getObra.mockResolvedValue({ ok: true, data: { obra: null } });
    getProject.mockResolvedValue({ ok: true, data: { project: null } });
    render(<Obra />);
    expect(await screen.findByText(/Todavía no tienes un proyecto asignado/)).toBeOnTheScreen();
  });

  it("offers a retry when loading fails, and refreshes on pull", async () => {
    getObra.mockResolvedValueOnce({ ok: false, error: "network_error" });
    const view = render(<Obra />);
    fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("52%")).toBeOnTheScreen();

    // A pull refreshes the photos too; a failed refresh keeps the data and says so.
    getObra.mockResolvedValueOnce({ ok: false, error: "network_error" });
    const scroll = view.UNSAFE_getByType(ScrollView);
    await act(async () => scroll.props.refreshControl.props.onRefresh());
    await waitFor(() => expect(getObra).toHaveBeenCalledTimes(3));
    expect(api.listPhotos).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se ha podido actualizar/);
    expect(screen.getByText("52%")).toBeOnTheScreen();
  });
});
