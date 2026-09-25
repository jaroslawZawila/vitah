import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import ProfileScreen from "../app/(app)/profile";
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
    expect(await screen.findByRole("switch", { name: "Acceso con Face ID" })).toBeOnTheScreen();

    fireEvent(toggle("Acceso con Face ID"), "valueChange", true);
    expect(mockLock.setEnabled).toHaveBeenCalledWith(true);

    mockLock.available = false;
    rerender(
      <I18nProvider>
        <ProfileScreen />
      </I18nProvider>,
    );
    expect(screen.queryByRole("switch", { name: "Acceso con Face ID" })).toBeNull();
  });

  it("hides notifications until push is set up", async () => {
    await renderProfile();

    expect(screen.queryByText("NOTIFICACIONES")).toBeNull();
  });

  it("opens Change password and signs out", async () => {
    await renderProfile();

    fireEvent.press(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    expect(mockPush).toHaveBeenCalledWith("/password");

    fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
