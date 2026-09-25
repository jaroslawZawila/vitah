import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import ProfileScreen from "../app/(app)/profile";
import { api } from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { registerForPush } from "../lib/push";
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
jest.mock("../lib/push", () => ({
  notificationsAllowed: jest.fn(async () => true),
  registerForPush: jest.fn(async () => "registered"),
}));
jest.mock("../lib/api", () => ({
  api: { getSettings: jest.fn(), updateSettings: jest.fn() },
}));

const settings = {
  notifications: { progress: true, documents: true, messages: false },
};

/** Renders and waits until the settings and permission checks have loaded. */
async function renderProfile() {
  const view = render(
    <I18nProvider>
      <ProfileScreen />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByRole("switch", { name: "Avances de obra" })).toBeEnabled());
  const { notificationsAllowed } = jest.requireMock("../lib/push");
  await waitFor(() => expect(notificationsAllowed).toHaveBeenCalled());
  return view;
}

const toggle = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
  secureStore.set("vitah_language", "es");
  mockLock.available = true;
  mockLock.enabled = false;
  jest.mocked(api.getSettings).mockResolvedValue({ ok: true, data: settings });
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

  it("shows the saved notification settings", async () => {
    await renderProfile();

    await waitFor(() => expect(toggle("Avances de obra")).toHaveProp("value", true));
    expect(toggle("Mensajes del equipo")).toHaveProp("value", false);
  });

  it("saves a toggle", async () => {
    jest.mocked(api.updateSettings).mockResolvedValue({
      ok: true,
      data: { ...settings, notifications: { ...settings.notifications, documents: false } },
    });
    await renderProfile();
    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", true));

    fireEvent(toggle("Nuevos documentos"), "valueChange", false);

    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", false));
    expect(api.updateSettings).toHaveBeenCalledWith("tok", { documents: false });
  });

  it("puts a toggle back and says so when saving fails", async () => {
    jest.mocked(api.updateSettings).mockResolvedValue({ ok: false, error: "network_error" });
    await renderProfile();
    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", true));

    fireEvent(toggle("Nuevos documentos"), "valueChange", false);

    expect(await screen.findByRole("alert")).toHaveTextContent(/No se ha podido guardar/);
    expect(toggle("Nuevos documentos")).toHaveProp("value", true);
  });

  it("rolls back only the switch whose save failed", async () => {
    let failProgress!: () => void;
    jest
      .mocked(api.updateSettings)
      .mockImplementationOnce(
        () => new Promise((resolve) => (failProgress = () => resolve({ ok: false, error: "network_error" }))),
      )
      .mockResolvedValueOnce({
        ok: true,
        data: { notifications: { progress: true, documents: false, messages: false } },
      });
    await renderProfile();

    fireEvent(toggle("Avances de obra"), "valueChange", false);
    fireEvent(toggle("Nuevos documentos"), "valueChange", false);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2));
    failProgress();

    await waitFor(() => expect(toggle("Avances de obra")).toHaveProp("value", true));
    expect(toggle("Nuevos documentos")).toHaveProp("value", false);
  });

  it("asks for notification permission when a toggle is turned on and pushes are off", async () => {
    const { notificationsAllowed } = jest.requireMock("../lib/push");
    notificationsAllowed.mockResolvedValue(false);
    jest.mocked(registerForPush).mockResolvedValue("denied");
    jest.mocked(api.updateSettings).mockResolvedValue({
      ok: true,
      data: { ...settings, notifications: { ...settings.notifications, messages: true } },
    });
    await renderProfile();

    expect(await screen.findByText(/Actívalas en los ajustes del teléfono/)).toBeOnTheScreen();
    await waitFor(() => expect(toggle("Mensajes del equipo")).toHaveProp("value", false));
    fireEvent(toggle("Mensajes del equipo"), "valueChange", true);

    await waitFor(() => expect(registerForPush).toHaveBeenCalledWith("tok", "es", { ask: true }));
    notificationsAllowed.mockResolvedValue(true);
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

  it("opens Change password and signs out", async () => {
    await renderProfile();

    fireEvent.press(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    expect(mockPush).toHaveBeenCalledWith("/password");

    fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
