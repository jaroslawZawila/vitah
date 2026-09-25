import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { NotificationSettings } from "../components/notification-settings";
import { api } from "../lib/api";
import { registerForPush } from "../lib/push";

// The section is hidden in Perfil for now (PUSH_NOTIFICATIONS); it stays
// tested so it's ready to switch on.

// Stable, like the real AuthProvider's: useClientData reloads when it changes.
const mockAuth = { token: "tok", signOut: jest.fn() };
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
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
async function renderSettings() {
  render(<NotificationSettings token="tok" />);
  await waitFor(() => expect(screen.getByRole("switch", { name: "Avances de obra" })).toBeEnabled());
  // Let the permission check's answer land.
  await act(async () => {});
}

const toggle = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.getSettings).mockResolvedValue({ ok: true, data: settings });
});

describe("NotificationSettings", () => {
  it("shows the saved notification settings", async () => {
    await renderSettings();

    await waitFor(() => expect(toggle("Avances de obra")).toHaveProp("value", true));
    expect(toggle("Mensajes del equipo")).toHaveProp("value", false);
  });

  it("saves a toggle", async () => {
    jest.mocked(api.updateSettings).mockResolvedValue({
      ok: true,
      data: { ...settings, notifications: { ...settings.notifications, documents: false } },
    });
    await renderSettings();
    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", true));

    fireEvent(toggle("Nuevos documentos"), "valueChange", false);

    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", false));
    expect(api.updateSettings).toHaveBeenCalledWith("tok", { documents: false });
  });

  it("puts a toggle back and says so when saving fails", async () => {
    jest.mocked(api.updateSettings).mockResolvedValue({ ok: false, error: "network_error" });
    await renderSettings();
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
    await renderSettings();

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
    await renderSettings();

    expect(await screen.findByText(/Actívalas en los ajustes del teléfono/)).toBeOnTheScreen();
    await waitFor(() => expect(toggle("Mensajes del equipo")).toHaveProp("value", false));
    fireEvent(toggle("Mensajes del equipo"), "valueChange", true);

    await waitFor(() => expect(registerForPush).toHaveBeenCalledWith("tok", "es", { ask: true }));
    // The save still goes through.
    await waitFor(() => expect(toggle("Mensajes del equipo")).toHaveProp("value", true));
    expect(api.updateSettings).toHaveBeenCalledWith("tok", { messages: true });
    notificationsAllowed.mockResolvedValue(true);
  });

});
