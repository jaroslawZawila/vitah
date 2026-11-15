import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { Alert, StyleSheet, type AlertButton } from "react-native";
import type { MobileWarranty, MobileWarrantyClaim, WarrantyClaimSummary } from "@repo/core/contract";
import WarrantyClaimScreen from "../app/(app)/warranty/[id]";
import WarrantyClaimsScreen from "../app/(app)/warranty/claims";
import WarrantyScreen from "../app/(app)/warranty/index";
import { api } from "../lib/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn();
let mockParams: Record<string, string> = {};
let mockProjectId = "p1";
/** The size of each picked file on the phone, by uri. */
const mockSizes: Record<string, number> = {};

jest.mock("../lib/use-project", () => {
  const { useMemo } = jest.requireActual<typeof import("react")>("react");
  const { useClientData } = jest.requireActual<typeof import("../lib/use-client-data")>("../lib/use-client-data");
  const project = { id: "p1" };
  return {
    useProject: () => ({ projectId: mockProjectId, project, projects: [project], select: jest.fn() }),
    useProjectData: (fetch: (token: string, projectId: string) => never) =>
      useClientData(useMemo(() => (token: string) => fetch(token, "p1"), [fetch])),
  };
});
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", signOut: mockSignOut }) }));
jest.mock("../lib/api", () => ({
  api: {
    getWarranty: jest.fn(),
    getWarrantyClaim: jest.fn(),
    createWarrantyClaim: jest.fn(),
    addWarrantyPhoto: jest.fn(),
    cancelWarrantyClaim: jest.fn(),
    warrantyPhotoUrl: (claimId: string, photoId: string) => `/warranty/${claimId}/photos/${photoId}`,
  },
}));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
    useLocalSearchParams: () => mockParams,
    // Focused while mounted.
    useFocusEffect: (effect: () => () => void) => useEffect(effect, [effect]),
  };
});
jest.mock("expo-file-system", () => ({
  File: class {
    mockUri: string;
    constructor(mockUri: string) {
      this.mockUri = mockUri;
    }
    get size() {
      return mockSizes[this.mockUri] ?? 0;
    }
  },
}));

const coverage: MobileWarranty["coverage"] = [
  { scope: "finishes", years: 1, endsOn: "2027-04-02", active: true },
  { scope: "habitability", years: 3, endsOn: "2029-04-02", active: true },
  { scope: "structure", years: 10, endsOn: "2036-04-02", active: true },
];

const summary = (overrides: Partial<WarrantyClaimSummary> = {}): WarrantyClaimSummary => ({
  id: "c-1",
  number: 1,
  kind: "plumbing",
  room: "bathroom",
  description: "Gotea el grifo.",
  urgent: false,
  status: "received",
  visitOn: null,
  answer: null,
  answeredAt: null,
  photoCount: 0,
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  ...overrides,
});

const warranty = (overrides: Partial<MobileWarranty> = {}): MobileWarranty => ({
  handedOver: true,
  handoverOn: "2026-04-02",
  handoverSource: "acta",
  coverage,
  claims: [],
  ...overrides,
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const failed = (error: string) => ({ ok: false as const, error }) as never;

/** Presses one of the buttons of the last Alert shown. */
function pressAlertButton(alert: jest.SpyInstance, text: string) {
  const buttons = alert.mock.calls.at(-1)![2] as AlertButton[];
  buttons.find((b) => b.text === text)!.onPress!();
}

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockProjectId = "p1";
  for (const uri of Object.keys(mockSizes)) delete mockSizes[uri];
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.mocked(api.getWarranty).mockResolvedValue(ok({ warranty: warranty() }));
});

async function fillClaim() {
  await screen.findByText("TIPO DE INCIDENCIA");
  fireEvent.press(screen.getByRole("radio", { name: "Fontanería" }));
  fireEvent.press(screen.getByRole("radio", { name: "Baño" }));
  fireEvent.changeText(screen.getByLabelText("DESCRIPCIÓN"), "El grifo del lavabo gotea.");
}
const send = () => fireEvent.press(screen.getByRole("button", { name: "ENVIAR SOLICITUD" }));

describe("WarrantyScreen", () => {
  it("before hand-over, says when the guarantee starts and shows no form", async () => {
    jest.mocked(api.getWarranty).mockResolvedValue(
      ok({ warranty: warranty({ handedOver: false, handoverOn: null, handoverSource: null, coverage: coverage.map((c) => ({ ...c, endsOn: null })) }) }),
    );
    render(<WarrantyScreen />);

    expect(await screen.findByText(/La garantía empieza el día que te entreguemos tu vivienda/)).toBeOnTheScreen();
    expect(screen.getByText("10 años")).toBeOnTheScreen();
    expect(screen.queryByText("TIPO DE INCIDENCIA")).toBeNull();
    expect(screen.queryByRole("button", { name: "ENVIAR SOLICITUD" })).toBeNull();
  });

  it("shows the three periods until their end, and links to the client's claims", async () => {
    jest.mocked(api.getWarranty).mockResolvedValue(ok({ warranty: warranty({ claims: [summary()] }) }));
    render(<WarrantyScreen />);

    expect(await screen.findByText("Hasta 2 abr 2036")).toBeOnTheScreen();
    expect(screen.getByText("Instalaciones")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("link", { name: "Mis solicitudes (1)" }));
    expect(mockPush).toHaveBeenCalledWith("/warranty/claims");
  });

  it("sends a claim with its photo, then opens it", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///grifo.jpg", fileName: "grifo.jpg", mimeType: "image/jpeg", fileSize: 1_500_000, width: 1, height: 1 }],
    } as never);
    jest.mocked(api.createWarrantyClaim).mockResolvedValue(ok({ claimId: "c-9", number: 9 }));
    jest.mocked(api.addWarrantyPhoto).mockResolvedValue(ok({ photoId: "ph-1" }));
    render(<WarrantyScreen />);
    await fillClaim();
    fireEvent(screen.getByRole("switch", { name: "Es urgente" }), "valueChange", true);

    fireEvent.press(screen.getByRole("button", { name: "Añadir foto" }));
    pressAlertButton(alert, "Elegir de la galería");
    expect(await screen.findByRole("button", { name: "Quitar la foto 1" })).toBeOnTheScreen();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 4 }),
    );

    send();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/warranty/c-9"));
    expect(api.createWarrantyClaim).toHaveBeenCalledWith(
      "tok",
      "p1",
      { kind: "plumbing", room: "bathroom", description: "El grifo del lavabo gotea.", urgent: true },
      expect.stringMatching(/^[A-Za-z0-9_-]{16,100}$/),
    );
    expect(api.addWarrantyPhoto).toHaveBeenCalledWith(
      "tok",
      "c-9",
      expect.objectContaining({ uri: "file:///grifo.jpg", name: "grifo.jpg", type: "image/jpeg" }),
      expect.any(String),
    );
    expect(alert).toHaveBeenLastCalledWith("Solicitud GAR-009 enviada", expect.any(String));
  });

  it("asks for the type, the room and the description before sending", async () => {
    render(<WarrantyScreen />);
    await screen.findByText("TIPO DE INCIDENCIA");

    send();

    expect(screen.getByRole("alert")).toHaveTextContent(/Elige el tipo y la estancia/);
    expect(api.createWarrantyClaim).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the connection fails, and sends the same claim again", async () => {
    jest.mocked(api.createWarrantyClaim).mockResolvedValueOnce(failed("network_error")).mockResolvedValueOnce(ok({ claimId: "c-2", number: 2 }));
    render(<WarrantyScreen />);
    await fillClaim();

    send();
    expect(await screen.findByRole("alert")).toHaveTextContent(/No hay conexión con ViTAH. Lo que has escrito sigue aquí/);
    expect(screen.getByLabelText("DESCRIPCIÓN")).toHaveDisplayValue("El grifo del lavabo gotea.");

    send();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/warranty/c-2"));
    const [first, second] = jest.mocked(api.createWarrantyClaim).mock.calls;
    expect(second![3]).toBe(first![3]); // the same key: one claim, whatever reached the server
  });

  it("goes on with the photos left when one fails after the claim is in", async () => {
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///a.jpg", mimeType: "image/jpeg", fileSize: 1000, width: 1, height: 1 }],
    } as never);
    jest.mocked(api.createWarrantyClaim).mockResolvedValue(ok({ claimId: "c-3", number: 3 }));
    jest.mocked(api.addWarrantyPhoto).mockResolvedValueOnce(failed("timeout")).mockResolvedValueOnce(ok({ photoId: "ph" }));
    render(<WarrantyScreen />);
    await fillClaim();
    fireEvent.press(screen.getByRole("button", { name: "Añadir foto" }));
    pressAlertButton(alert, "Hacer una foto");
    await screen.findByRole("button", { name: "Quitar la foto 1" });

    send();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Tu solicitud GAR-003 se ha enviado, pero falta alguna foto/);

    send();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/warranty/c-3"));
    expect(api.createWarrantyClaim).toHaveBeenCalledTimes(1);
    const [first, second] = jest.mocked(api.addWarrantyPhoto).mock.calls;
    expect(second![3]).toBe(first![3]);
  });

  it("refuses a photo over 4 MB before sending it", async () => {
    mockSizes["file:///big.jpg"] = 9_000_000;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///big.jpg", mimeType: "image/jpeg", fileSize: 9_000_000, width: 1, height: 1 }],
    } as never);
    render(<WarrantyScreen />);
    await screen.findByText("TIPO DE INCIDENCIA");

    fireEvent.press(screen.getByRole("button", { name: "Añadir foto" }));
    pressAlertButton(alert, "Elegir de la galería");

    await waitFor(() => expect(alert).toHaveBeenLastCalledWith("Esta foto ocupa más de 4 MB. Prueba con otra."));
    expect(screen.queryByRole("button", { name: "Quitar la foto 1" })).toBeNull();
  });

  it("lets the client swap a photo the server refused, and sends only what is missing", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///a.jpg", mimeType: "image/jpeg", width: 1, height: 1 },
        { uri: "file:///b.jpg", mimeType: "image/jpeg", width: 1, height: 1 },
      ],
    } as never);
    jest.mocked(api.createWarrantyClaim).mockResolvedValue(ok({ claimId: "c-4", number: 4 }));
    jest.mocked(api.addWarrantyPhoto).mockResolvedValueOnce(ok({ photoId: "ph-a" })).mockResolvedValueOnce(failed("file_too_large"));
    render(<WarrantyScreen />);
    await fillClaim();
    fireEvent.press(screen.getByRole("button", { name: "Añadir foto" }));
    pressAlertButton(alert, "Elegir de la galería");
    await screen.findByRole("button", { name: "Quitar la foto 2" });

    send();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Quítala y prueba con otra/);
    // The claim is in: its fields are locked, the photo uploaded stays, the refused one can go.
    expect(screen.getByRole("radio", { name: "Fontanería" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Quitar la foto 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Añadir foto" })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Quitar la foto 2" }));

    send();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/warranty/c-4"));
    expect(api.createWarrantyClaim).toHaveBeenCalledTimes(1);
    expect(jest.mocked(api.addWarrantyPhoto).mock.calls.map((call) => call[2].uri)).toEqual(["file:///a.jpg", "file:///b.jpg"]);
  });

  it("finishes sending after the client leaves, without opening the claim over what they do", async () => {
    let created!: (value: never) => void;
    jest.mocked(api.createWarrantyClaim).mockReturnValue(new Promise((resolve) => (created = resolve)));
    render(<WarrantyScreen />);
    await fillClaim();

    send();
    screen.unmount();
    created(ok({ claimId: "c-5", number: 5 }) as never);

    await waitFor(() => expect(api.createWarrantyClaim).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalledWith("Solicitud GAR-005 enviada", expect.any(String));
  });

  it("sends the claim to the home shown when the form opened", async () => {
    jest.mocked(api.createWarrantyClaim).mockResolvedValue(ok({ claimId: "c-6", number: 6 }));
    render(<WarrantyScreen />);
    await fillClaim();

    // A tapped push shows another home meanwhile.
    mockProjectId = "p2";
    screen.rerender(<WarrantyScreen />);
    send();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/warranty/c-6"));
    expect(api.createWarrantyClaim).toHaveBeenCalledWith("tok", "p1", expect.anything(), expect.any(String));
  });

  it("gives the remove-photo button a 44 pt target", async () => {
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///a.jpg", mimeType: "image/jpeg", width: 1, height: 1 }],
    } as never);
    render(<WarrantyScreen />);
    await screen.findByText("TIPO DE INCIDENCIA");
    fireEvent.press(screen.getByRole("button", { name: "Añadir foto" }));
    pressAlertButton(alert, "Hacer una foto");

    const remove = await screen.findByRole("button", { name: "Quitar la foto 1" });
    const { width, height } = StyleSheet.flatten(remove.props.style) as { width: number; height: number };
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(44);
  });

  it.each([
    ["too_many_claims_today", /Has enviado varias solicitudes hoy/],
    ["too_many_open_claims", /Tienes varias solicitudes abiertas/],
    ["not_handed_over", /La garantía empieza con la entrega/],
    ["something_new", /No se ha podido enviar/],
  ])("says what %s means", async (code, message) => {
    jest.mocked(api.createWarrantyClaim).mockResolvedValue(failed(code));
    render(<WarrantyScreen />);
    await fillClaim();

    send();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("signs out when the session is no longer valid", async () => {
    jest.mocked(api.createWarrantyClaim).mockResolvedValue(failed("unauthorized"));
    render(<WarrantyScreen />);
    await fillClaim();

    send();

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it("offers a retry when the screen can't load", async () => {
    jest.mocked(api.getWarranty).mockResolvedValueOnce(failed("network_error"));
    render(<WarrantyScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("TIPO DE INCIDENCIA")).toBeOnTheScreen();
  });
});

describe("WarrantyClaimsScreen", () => {
  it("lists the claims with their status and the builder's answer, each opening its page", async () => {
    jest.mocked(api.getWarranty).mockResolvedValue(
      ok({
        warranty: warranty({
          claims: [
            summary({ id: "c-2", number: 2, kind: "damp", status: "scheduled", answer: "Iremos el lunes.", urgent: true }),
            summary({ id: "c-1", status: "from_a_newer_server" as never }),
          ],
        }),
      }),
    );
    render(<WarrantyClaimsScreen />);

    expect(await screen.findByText("GAR-002 · Humedades")).toBeOnTheScreen();
    expect(screen.getByText("Visita programada · Enviada el 2 nov · Urgente")).toBeOnTheScreen();
    expect(screen.getByText("Respuesta: Iremos el lunes.")).toBeOnTheScreen();
    // A status the app doesn't know yet is left out, never "undefined".
    expect(screen.getByText("Enviada el 2 nov")).toBeOnTheScreen();

    fireEvent.press(screen.getByText("GAR-001 · Fontanería"));
    expect(mockPush).toHaveBeenCalledWith("/warranty/c-1");
  });

  it("says when there are none yet", async () => {
    render(<WarrantyClaimsScreen />);
    expect(await screen.findByText("Todavía no has enviado ninguna solicitud.")).toBeOnTheScreen();
  });
});

describe("WarrantyClaimScreen", () => {
  const claim = (overrides: Partial<MobileWarrantyClaim> = {}): MobileWarrantyClaim => ({
    ...summary(),
    photoIds: ["ph-1"],
    events: [
      { id: "e-1", action: "created", at: "2026-11-02T10:00:00.000Z", byClient: true, detail: {} },
      {
        id: "e-2",
        action: "updated",
        at: "2026-11-03T10:00:00.000Z",
        byClient: false,
        detail: { status: { from: "received", to: "scheduled" }, visitOn: { from: null, to: "2026-11-20" } },
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    mockParams = { id: "c-1" };
  });

  it("shows the visit, the builder's answer, what was sent and its history", async () => {
    jest.mocked(api.getWarrantyClaim).mockResolvedValue(ok(claim({ status: "scheduled", visitOn: "2026-11-20", answer: "Llevaremos el repuesto." })));
    render(<WarrantyClaimScreen />);

    expect(await screen.findByText("Fontanería · Baño")).toBeOnTheScreen();
    expect(screen.getByText("GAR-001 · 2 nov")).toBeOnTheScreen();
    expect(screen.getByText("Visita programada")).toBeOnTheScreen();
    expect(screen.getByText("20 nov 2026")).toBeOnTheScreen();
    expect(screen.getByText("Llevaremos el repuesto.")).toBeOnTheScreen();
    expect(screen.getByText("Visita programada · Visita el 20 nov 2026")).toBeOnTheScreen();
    expect(screen.getByText("ViTAH")).toBeOnTheScreen();
    expect(screen.getByText("Tú")).toBeOnTheScreen();
    // Nobody can cancel what has started.
    expect(screen.queryByRole("button", { name: "CANCELAR SOLICITUD" })).toBeNull();
  });

  it("cancels a claim nobody has started on, after asking", async () => {
    jest.mocked(api.getWarrantyClaim).mockResolvedValueOnce(ok(claim())).mockResolvedValue(ok(claim({ status: "cancelled" })));
    jest.mocked(api.cancelWarrantyClaim).mockResolvedValue(ok({ claimId: "c-1" }));
    render(<WarrantyClaimScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "CANCELAR SOLICITUD" }));
    expect(api.cancelWarrantyClaim).not.toHaveBeenCalled();
    pressAlertButton(alert, "Cancelar solicitud");

    await waitFor(() => expect(api.cancelWarrantyClaim).toHaveBeenCalledWith("tok", "c-1"));
    expect(await screen.findByText("Cancelada")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "CANCELAR SOLICITUD" })).toBeNull();
  });

  it("says when the builder started on it meanwhile", async () => {
    jest.mocked(api.getWarrantyClaim).mockResolvedValue(ok(claim()));
    jest.mocked(api.cancelWarrantyClaim).mockResolvedValue(failed("claim_closed"));
    render(<WarrantyClaimScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "CANCELAR SOLICITUD" }));
    pressAlertButton(alert, "Cancelar solicitud");

    await waitFor(() => expect(alert).toHaveBeenLastCalledWith(expect.stringMatching(/ya ha empezado con esta solicitud/)));
  });

  it("offers a retry when the claim can't be loaded", async () => {
    jest.mocked(api.getWarrantyClaim).mockResolvedValue(failed("not_found"));
    render(<WarrantyClaimScreen />);

    expect(await screen.findByText(/No hemos podido cargar tu solicitud/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeOnTheScreen();
  });
});
