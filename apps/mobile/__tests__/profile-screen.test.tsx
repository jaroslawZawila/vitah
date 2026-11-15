import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import ProfileScreen from "../app/(app)/(tabs)/profile";
import { api } from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { secureStore } from "../test-utils/secure-store";

const mockSignOut = jest.fn();
const mockPush = jest.fn();
const mockLock = { available: true, method: "faceId", enabled: false, setEnabled: jest.fn() };
// Stable, like the real AuthProvider's: useClientData reloads when it changes.
const mockAuth = {
  token: "tok",
  user: { id: "u", email: "elena@example.com", name: "Elena Martín", tenantId: "t" },
  signOut: mockSignOut,
};
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
jest.mock("../lib/app-lock", () => ({ useAppLock: () => mockLock }));
/** The last focus effect: calling it again is Perfil shown again. */
let mockFocus: () => void = () => {};
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocus = effect;
        effect();
      }, [effect]),
  };
});
jest.mock("../lib/api", () => ({
  api: { getSettings: jest.fn(), withdrawDeletion: jest.fn() },
}));
const mockLinks = { HELP_URL: null as string | null, PRIVACY_URL: null as string | null };
jest.mock("../constants/links", () => ({
  get HELP_URL() {
    return mockLinks.HELP_URL;
  },
  get PRIVACY_URL() {
    return mockLinks.PRIVACY_URL;
  },
}));
jest.mock("../components/notification-settings", () => ({
  NotificationSettings: ({ token, allHomes }: { token: string; allHomes?: boolean }) => {
    const { createElement } = jest.requireActual<typeof import("react")>("react");
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return createElement(Text, null, `notifications for ${token}${allHomes ? " (all homes)" : ""}`);
  },
}));
const getSettings = jest.mocked(api.getSettings);
const withdrawDeletion = jest.mocked(api.withdrawDeletion);
const settingsWith = (deletionRequestedAt?: string | null) => ({
  ok: true as const,
  data: {
    notifications: { progress: true, documents: true, messages: true },
    ...(deletionRequestedAt === undefined ? {} : { deletionRequestedAt }),
  },
});
const home = (id: string, ref: string, address: string, handedOver: boolean) => ({
  id,
  ref,
  address,
  startDate: "2024-02-01",
  completionDate: "2025-06-12",
  handedOver,
  progressPct: handedOver ? null : 62,
});
const mockSelect = jest.fn();
const castelar = home("p1", "VTH-26-001", "Calle Castelar 12, Santander", false);
const sierra = home("p0", "VTH-24-007", "Barrio La Sierra 4, Liencres", true);
let mockHomes = [castelar];
jest.mock("../lib/use-project", () => ({
  useProject: () => ({ project: mockHomes[0], projects: mockHomes, select: mockSelect }),
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.2.0" } } }));
/** Renders and waits until the stored language has loaded. */
async function renderProfile() {
  const view = render(
    <I18nProvider>
      <ProfileScreen />
    </I18nProvider>,
  );
  await screen.findByText("IDIOMA");
  return view;
}

const toggle = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockHomes = [castelar];
  secureStore.clear();
  secureStore.set("vitah_language", "es");
  mockLock.available = true;
  mockLock.enabled = false;
  mockLinks.HELP_URL = null;
  mockLinks.PRIVACY_URL = null;
  getSettings.mockResolvedValue(settingsWith(null));
});

describe("ProfileScreen", () => {
  it("shows who is signed in and the app version", async () => {
    await renderProfile();

    expect(await screen.findByText("Elena Martín")).toBeOnTheScreen();
    expect(screen.getByText("E")).toBeOnTheScreen();
    expect(screen.getByText("elena@example.com")).toBeOnTheScreen();
    expect(screen.getByText("ViTAH · VERSIÓN 1.2.0")).toBeOnTheScreen();
  });

  it("switches the whole screen to English", async () => {
    await renderProfile();
    await screen.findByText("IDIOMA");

    fireEvent.press(screen.getByRole("radio", { name: "English" }));

    expect(await screen.findByText("LANGUAGE")).toBeOnTheScreen();
    expect(screen.getByText("Sign out")).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "English" })).toBeSelected();
  });

  it("offers the biometric lock only when the phone has it", async () => {
    const { rerender } = await renderProfile();
    expect(await screen.findByRole("switch", { name: "Acceso biométrico" })).toBeOnTheScreen();

    fireEvent(toggle("Acceso biométrico"), "valueChange", true);
    expect(mockLock.setEnabled).toHaveBeenCalledWith(true);

    mockLock.available = false;
    rerender(
      <I18nProvider>
        <ProfileScreen />
      </I18nProvider>,
    );
    expect(screen.queryByRole("switch", { name: "Acceso biométrico" })).toBeNull();
  });

  it("shows the notification settings for the signed-in client", async () => {
    await renderProfile();

    expect(screen.getByText("notifications for tok")).toBeOnTheScreen();
  });

  it("opens Change password and signs out", async () => {
    await renderProfile();

    fireEvent.press(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    expect(mockPush).toHaveBeenCalledWith("/password");

    fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe("ProfileScreen › Mis viviendas", () => {
  it("is left out with one home", async () => {
    await renderProfile();

    expect(screen.queryByText("Mis viviendas")).toBeNull();
    expect(screen.getByText("notifications for tok")).toBeOnTheScreen();
  });

  it("lists every home, marks the one shown and shows another when picked", async () => {
    mockHomes = [castelar, sierra];
    await renderProfile();

    expect(screen.getByText("Mis viviendas")).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: /Calle Castelar 12/ })).toBeSelected();
    expect(screen.getByText("Viendo")).toBeOnTheScreen();
    expect(screen.getByText(/^VTH-24-007 · Entregada · jun\.? 2025$/)).toBeOnTheScreen();
    expect(screen.getByText("notifications for tok (all homes)")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("radio", { name: /Barrio La Sierra 4/ }));
    expect(mockSelect).toHaveBeenCalledWith("p0");
  });
});

describe("ProfileScreen › help and privacy", () => {
  it("leaves both rows out when the build sets no pages", async () => {
    await renderProfile();

    expect(screen.queryByText("Ayuda y preguntas frecuentes")).toBeNull();
    expect(screen.queryByText("Privacidad y datos")).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeOnTheScreen();
  });

  it("shows only the rows whose page is set, and opens it in the browser", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    mockLinks.PRIVACY_URL = "https://vitah.es/privacidad";
    await renderProfile();

    expect(screen.queryByText("Ayuda y preguntas frecuentes")).toBeNull();
    fireEvent.press(screen.getByRole("link", { name: "Privacidad y datos" }));
    expect(open).toHaveBeenCalledWith("https://vitah.es/privacidad");

    mockLinks.HELP_URL = "https://vitah.es/ayuda";
    fireEvent.press(screen.getByRole("radio", { name: "English" }));
    fireEvent.press(await screen.findByRole("link", { name: "Help and FAQ" }));
    expect(open).toHaveBeenCalledWith("https://vitah.es/ayuda");
  });
});

describe("ProfileScreen › asking for the account to be deleted", () => {
  it("offers it at the foot, on a screen of its own", async () => {
    await renderProfile();

    fireEvent.press(await screen.findByRole("button", { name: "Solicitar la baja de mi cuenta" }));

    expect(mockPush).toHaveBeenCalledWith("/account-deletion");
  });

  it("shows since when it was asked, and withdraws it", async () => {
    getSettings.mockResolvedValueOnce(settingsWith("2026-11-12T09:30:00.000Z"));
    withdrawDeletion.mockResolvedValue({ ok: true, data: { deletionRequestedAt: null } });
    await renderProfile();

    expect(await screen.findByText("Baja solicitada el 12 nov 2026")).toBeOnTheScreen();
    expect(screen.getByText("Tu equipo de ViTAH se pondrá en contacto contigo.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Solicitar la baja de mi cuenta" })).toBeNull();

    fireEvent.press(screen.getByRole("button", { name: "Retirar la solicitud" }));

    expect(withdrawDeletion).toHaveBeenCalledWith("tok");
    // Loaded again from the server.
    expect(await screen.findByRole("button", { name: "Solicitar la baja de mi cuenta" })).toBeOnTheScreen();
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it("says so when withdrawing fails, keeping the request shown", async () => {
    getSettings.mockResolvedValue(settingsWith("2026-11-12T09:30:00.000Z"));
    withdrawDeletion.mockResolvedValue({ ok: false, error: "network_error" });
    await renderProfile();

    fireEvent.press(await screen.findByRole("button", { name: "Retirar la solicitud" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido retirar. Comprueba tu conexión.");
    expect(screen.getByText("Baja solicitada el 12 nov 2026")).toBeOnTheScreen();
  });

  it("loads where it stands again when Perfil is shown again (back from asking)", async () => {
    await renderProfile();
    await screen.findByRole("button", { name: "Solicitar la baja de mi cuenta" });
    expect(getSettings).toHaveBeenCalledTimes(1);
    getSettings.mockResolvedValue(settingsWith("2026-11-15T08:00:00.000Z"));

    act(() => mockFocus());

    expect(await screen.findByText("Baja solicitada el 15 nov 2026")).toBeOnTheScreen();
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it("is left out by a server that doesn't say (an older one)", async () => {
    getSettings.mockResolvedValue(settingsWith(undefined));
    await renderProfile();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.queryByRole("button", { name: "Solicitar la baja de mi cuenta" })).toBeNull();
    expect(screen.queryByText(/Baja solicitada/)).toBeNull();
  });
});
