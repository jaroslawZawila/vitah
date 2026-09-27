import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import FaseScreen from "../app/(app)/obra/fase/[key]";
import PagoScreen from "../app/(app)/obra/pago/[id]";
import PagosScreen from "../app/(app)/obra/pagos";
import { api } from "../lib/api";
import { openHitoFile } from "../lib/hito-files";
import { ObraProvider } from "../lib/use-obra";
import { PhotosProvider } from "../lib/use-photos";
import { obra } from "../test-utils/obra-fixture";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: Record<string, string> = {};

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: { name: "Ana" }, signOut: jest.fn() }),
}));
jest.mock("../lib/api", () => ({
  api: { getObra: jest.fn(), listPhotos: jest.fn(), photoUrl: (id: string) => `/photos/${id}` },
}));
jest.mock("../lib/hito-files", () => ({ openHitoFile: jest.fn() }));
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    navigate: mockNavigate,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
}));

const photo = (id: string, caption: string) => ({ id, caption, sizeBytes: 1, uploadedAt: "2026-09-25T10:00:00Z" });

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  jest.mocked(api.getObra).mockResolvedValue({ ok: true, data: { obra } });
  jest.mocked(api.listPhotos).mockResolvedValue({
    ok: true,
    data: { photos: [photo("p1", "Paneles de cubierta"), photo("p2", "Estructura")] },
  });
});

const wrap = (node: React.ReactNode) => (
  <PhotosProvider>
    <ObraProvider>{node}</ObraProvider>
  </PhotosProvider>
);

describe("FaseScreen", () => {
  it("shows a phase: its chapters, photos, what closes it and its payment", async () => {
    mockParams = { key: "H4" };
    render(wrap(<FaseScreen />));

    expect(await screen.findByText("Fase 3 de 4 · En curso")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Envolvente estanca" })).toBeOnTheScreen();
    expect(screen.getByText(/Thermochip en fachada y cubierta/)).toBeOnTheScreen();
    expect(screen.getByText("Capítulo 05 · 86.304,39 €")).toBeOnTheScreen();
    expect(screen.getByText("80 %")).toBeOnTheScreen();
    expect(screen.getByText("Prueba de estanqueidad provisional")).toBeOnTheScreen();
    expect(screen.getByText(/^Paneles de cubierta · 25 sept?/)).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: /Pago al cerrar la fase · H4/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/obra/pago/[id]", params: { id: "h4" } });
    fireEvent.press(screen.getByRole("link", { name: "Ver la foto" }));
    // Switches to the Fotos tab, not a second tab bar over this screen.
    expect(mockNavigate).toHaveBeenCalledWith("/photos");
  });

  it("shows the pre-construction phase with its payments", async () => {
    mockParams = { key: "pre" };
    render(wrap(<FaseScreen />));

    expect(await screen.findByRole("header", { name: "Proyecto y licencia" })).toBeOnTheScreen();
    expect(screen.getByText("Fase 1 de 4 · Terminada")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: /H1 · Ingeniería BIM/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/obra/pago/[id]", params: { id: "h1" } });
  });

  it("says when the phase doesn't exist", async () => {
    mockParams = { key: "H7" };
    render(wrap(<FaseScreen />));
    expect(await screen.findByText("No encontramos esta fase.")).toBeOnTheScreen();
  });
});

describe("back link", () => {
  it("goes back", async () => {
    mockParams = { key: "H4" };
    render(wrap(<FaseScreen />));
    await screen.findByText("Fase 3 de 4 · En curso");
    fireEvent.press(screen.getByRole("button", { name: "Obra" }));
    expect(mockBack).toHaveBeenCalled();
  });

  it("goes to the Obra tab when the screen was opened directly", async () => {
    mockParams = { key: "H4" };
    mockCanGoBack = false;
    render(wrap(<FaseScreen />));
    await screen.findByText("Fase 3 de 4 · En curso");
    fireEvent.press(screen.getByRole("button", { name: "Obra" }));
    expect(mockReplace).toHaveBeenCalledWith("/obra");
  });
});

describe("PagosScreen", () => {
  it("offers a retry when the obra can't be loaded", async () => {
    jest.mocked(api.getObra).mockResolvedValue({ ok: false, error: "network_error" });
    render(wrap(<PagosScreen />));
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    jest.mocked(api.getObra).mockResolvedValue({ ok: true, data: { obra } });
    fireEvent.press(retry);
    expect(await screen.findByText("Hitos de pago")).toBeOnTheScreen();
  });

  it("shows what is paid, the next payment and every hito", async () => {
    render(wrap(<PagosScreen />));

    expect(await screen.findByText("de 448.205,03 € · 2 de 5 hitos · sin IVA")).toBeOnTheScreen();
    expect(screen.getByText("Próximo pago · vence 1 oct")).toBeOnTheScreen();
    expect(screen.getByText("Pagado el 3 feb 2026")).toBeOnTheScreen();
    expect(screen.getByText("Por pagar")).toBeOnTheScreen();
    expect(screen.getByText("Acta firmada el 24 sept 2026 · vence el 1 oct 2026")).toBeOnTheScreen();
    expect(screen.getByText("En curso")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: /H3 · Estructura Steel Frame/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/obra/pago/[id]", params: { id: "h3" } });
  });
});

describe("PagoScreen", () => {
  it("shows the amounts, the acta's photos and its documents", async () => {
    mockParams = { id: "h3" };
    render(wrap(<PagoScreen />));

    expect(await screen.findByRole("header", { name: "Estructura Steel Frame" })).toBeOnTheScreen();
    expect(screen.getByText("Hito H3 · 15 % del presupuesto")).toBeOnTheScreen();
    expect(screen.getByText("Por pagar · vence 1 oct 2026")).toBeOnTheScreen();
    expect(screen.getByText("67.230,75 €")).toBeOnTheScreen();
    expect(screen.getByText("6723,08 €")).toBeOnTheScreen();
    expect(screen.getByText("73.953,83 €")).toBeOnTheScreen();
    expect(await screen.findByText("2 fotos")).toBeOnTheScreen();
    expect(screen.getByText("Firmada el 24 sept 2026 por la propiedad y el constructor")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: /Acta de conformidad H3/ }));
    await waitFor(() => expect(openHitoFile).toHaveBeenCalledWith("tok", "h3", "acta"));
    fireEvent.press(screen.getByRole("button", { name: "Ver factura" }));
    await waitFor(() => expect(openHitoFile).toHaveBeenCalledWith("tok", "h3", "invoice"));
  });

  it("says when a document can't be opened", async () => {
    mockParams = { id: "h3" };
    jest.mocked(openHitoFile).mockRejectedValueOnce(new Error("offline"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(wrap(<PagoScreen />));

    fireEvent.press(await screen.findByRole("button", { name: "Ver factura" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringMatching(/No hemos podido abrir/)));
  });

  it("shows what was actually paid", async () => {
    mockParams = { id: "h1" };
    render(wrap(<PagoScreen />));
    expect(await screen.findByText("Pagado · 20 abr 2026")).toBeOnTheScreen();
    expect(screen.getByText("Pagado el 20 abr 2026")).toBeOnTheScreen();
    // The total and what was paid: the same here.
    expect(screen.getAllByText("34.511,79 €")).toHaveLength(2);
  });

  it("has no documents before the acta", async () => {
    mockParams = { id: "h4" };
    render(wrap(<PagoScreen />));
    expect(await screen.findByRole("header", { name: "Envolvente estanca" })).toBeOnTheScreen();
    expect(screen.getByText("Qué incluye")).toBeOnTheScreen();
    expect(screen.queryByText("Documentos")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver factura" })).toBeNull();
  });
});
