import { fireEvent, render, screen } from "@testing-library/react-native";
import { Image } from "expo-image";
import type { MobilePhoto } from "@repo/core/contract";
import PhotosScreen from "../app/(app)/photos";
import { usePhotos } from "../lib/use-photos";

jest.mock("../lib/use-photos", () => ({ usePhotos: jest.fn() }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok" }) }));

const photo = (overrides: Partial<MobilePhoto>): MobilePhoto => ({
  id: "p1",
  caption: "Fachada sur",
  sizeBytes: 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
  ...overrides,
});

const facade = photo({});
const roof = photo({ id: "p2", caption: null, uploadedAt: "2026-09-21T10:00:00.000Z" });
const insulation = photo({ id: "p3", caption: "Aislamiento", uploadedAt: "2026-09-08T10:00:00.000Z" });

const refresh = jest.fn();
const retry = jest.fn();

function state(overrides: Partial<ReturnType<typeof usePhotos>> = {}) {
  jest.mocked(usePhotos).mockReturnValue({
    photos: [facade, roof, insulation],
    error: false,
    refreshing: false,
    refresh,
    retry,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  state();
});

describe("PhotosScreen", () => {
  it("groups photos by week with the count", () => {
    render(<PhotosScreen />);

    expect(screen.getByText("3 fotos")).toBeOnTheScreen();
    expect(screen.getByText("Fotografías")).toBeOnTheScreen();
    expect(screen.getByText("Semana 39")).toBeOnTheScreen();
    expect(screen.getByText("Semana 37")).toBeOnTheScreen();
    // The newest photo of the week shows its caption.
    expect(screen.getByText("Fachada sur")).toBeOnTheScreen();
  });

  it("loads thumbnails in the grid with the client's token", () => {
    render(<PhotosScreen />);

    const images = screen.UNSAFE_getAllByType(Image);
    expect(images[0]?.props.source).toEqual({
      uri: expect.stringMatching(/\/api\/mobile\/photos\/p1\?size=thumb$/),
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("labels photos without a caption by date", () => {
    render(<PhotosScreen />);

    expect(screen.getByRole("imagebutton", { name: /^Foto del 21 sept?\.?$/ })).toBeOnTheScreen();
  });

  it("opens a photo full screen and closes it", () => {
    render(<PhotosScreen />);

    fireEvent.press(screen.getByRole("imagebutton", { name: "Aislamiento" }));
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeOnTheScreen();
    // The viewer shows the original.
    const sources = screen.UNSAFE_getAllByType(Image).map((image) => image.props.source.uri);
    expect(sources).toContainEqual(expect.stringMatching(/\/api\/mobile\/photos\/p3$/));
    // On the tile and, now, under the full-size photo.
    expect(screen.getAllByText("Aislamiento")).toHaveLength(2);

    fireEvent.press(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull();
  });

  it("shows a spinner while loading", () => {
    state({ photos: undefined });
    render(<PhotosScreen />);

    expect(screen.getByLabelText("Cargando las fotos de tu obra")).toBeOnTheScreen();
  });

  it("offers a retry when the first load fails", () => {
    state({ photos: undefined, error: true });
    render(<PhotosScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalled();
  });

  it("keeps showing photos when a refresh fails", () => {
    state({ error: true });
    render(<PhotosScreen />);

    expect(screen.getByText(/No hemos podido actualizar las fotos/)).toBeOnTheScreen();
    expect(screen.getByText("Fachada sur")).toBeOnTheScreen();
  });

  it("shows an empty state", () => {
    state({ photos: [] });
    render(<PhotosScreen />);

    expect(screen.getByText("0 fotos")).toBeOnTheScreen();
    expect(screen.getByText(/Todavía no hay fotos/)).toBeOnTheScreen();
  });
});
