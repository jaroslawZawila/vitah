import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { MobileSettings } from "@repo/core/contract";
import { NotificationSettings } from "../components/notification-settings";
import { api } from "../lib/api";
import { registerForPush } from "../lib/push";

jest.mock("../lib/push", () => ({
  notificationsAllowed: jest.fn(async () => true),
  registerForPush: jest.fn(async () => "registered"),
}));
jest.mock("../lib/api", () => ({
  api: { updateSettings: jest.fn() },
}));

const settings: MobileSettings = {
  notifications: { progress: true, documents: true, messages: false },
  deletionRequestedAt: null,
};
const documentsOff = { ...settings, notifications: { ...settings.notifications, documents: false } };

/** Renders with the settings Perfil loaded, and waits for the permission check. */
async function renderSettings(saved: MobileSettings = settings) {
  render(<NotificationSettings token="tok" saved={saved} />);
  await waitFor(() => expect(screen.getByRole("switch", { name: "Avances de obra" })).toBeEnabled());
  // Let the permission check's answer land.
  await act(async () => {});
}

const toggle = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NotificationSettings", () => {
  it("shows the saved notification settings", async () => {
    await renderSettings(documentsOff);

    expect(toggle("Avances de obra")).toHaveProp("value", true);
    expect(toggle("Nuevos documentos")).toHaveProp("value", false);
  });

  it("offers team messages: changes to approve and warranty answers", async () => {
    await renderSettings();

    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(toggle("Mensajes del equipo")).toHaveProp("value", false);
  });

  it("waits, switched off, until Perfil has loaded the settings", async () => {
    render(<NotificationSettings token="tok" saved={undefined} />);
    await act(async () => {});

    expect(toggle("Avances de obra")).toHaveProp("disabled", true);
    expect(toggle("Avances de obra")).toHaveProp("value", false);
  });

  it("saves a toggle", async () => {
    jest.mocked(api.updateSettings).mockResolvedValue({ ok: true, data: documentsOff });
    await renderSettings();

    fireEvent(toggle("Nuevos documentos"), "valueChange", false);

    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", false));
    expect(api.updateSettings).toHaveBeenCalledWith("tok", { documents: false });
  });

  it("puts a toggle back and says so when saving fails", async () => {
    jest.mocked(api.updateSettings).mockResolvedValue({ ok: false, error: "network_error" });
    await renderSettings();

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
      .mockResolvedValueOnce({ ok: true, data: documentsOff });
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
    jest.mocked(api.updateSettings).mockResolvedValue({ ok: true, data: settings });
    await renderSettings(documentsOff);

    expect(await screen.findByText(/Actívalas en los ajustes del teléfono/)).toBeOnTheScreen();
    fireEvent(toggle("Nuevos documentos"), "valueChange", true);

    await waitFor(() => expect(registerForPush).toHaveBeenCalledWith("tok", "es", { ask: true }));
    // The save still goes through.
    await waitFor(() => expect(toggle("Nuevos documentos")).toHaveProp("value", true));
    expect(api.updateSettings).toHaveBeenCalledWith("tok", { documents: true });
    notificationsAllowed.mockResolvedValue(true);
  });
});
