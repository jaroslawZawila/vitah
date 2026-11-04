import { fireEvent, render, screen } from "@testing-library/react-native";
import ProfileScreen from "../app/(app)/(tabs)/profile";
import { I18nProvider } from "../lib/i18n";
import { secureStore } from "../test-utils/secure-store";

const mockSignOut = jest.fn();
const mockPush = jest.fn();
const mockLock = { available: true, method: "faceId", enabled: false, setEnabled: jest.fn() };
jest.mock("../lib/auth", () => ({
  useAuth: () => ({
    token: "tok",
    user: { id: "u", email: "elena@example.com", name: "Elena Martín", tenantId: "t" },
    signOut: mockSignOut,
  }),
}));
jest.mock("../lib/app-lock", () => ({ useAppLock: () => mockLock }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../components/notification-settings", () => ({
  NotificationSettings: ({ token, allHomes }: { token: string; allHomes?: boolean }) => {
    const { createElement } = jest.requireActual<typeof import("react")>("react");
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return createElement(Text, null, `notifications for ${token}${allHomes ? " (all homes)" : ""}`);
  },
}));
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
