import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import type { MobileContact } from "@repo/core/contract";
import ContactScreen, { initials, telUrl } from "../app/(app)/contact";
import { api } from "../lib/api";

const mockBack = jest.fn();
const mockNavigate = jest.fn();

// The home shown is p1 (Contacto never switches home).
jest.mock("../lib/use-project", () => {
  const { useMemo } = jest.requireActual<typeof import("react")>("react");
  const { useClientData } = jest.requireActual<typeof import("../lib/use-client-data")>("../lib/use-client-data");
  return {
    useProjectData: (fetch: (token: string, projectId: string) => never) =>
      useClientData(useMemo(() => (token: string) => fetch(token, "p1"), [fetch])),
  };
});
const mockSignOut = jest.fn();
jest.mock("../lib/auth", () => ({
  useAuth: () => ({ token: "tok", user: { name: "Ana" }, signOut: mockSignOut }),
}));
jest.mock("../lib/api", () => ({ api: { getContact: jest.fn() } }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn(), navigate: mockNavigate }),
}));

const getContact = jest.mocked(api.getContact);

const full: MobileContact = {
  siteManager: { name: "Javier Ruiz", phone: "+34 600 111 222", email: "javier@example.com" },
  office: {
    name: "ViTAH Santander",
    address: "Camargo, Cantabria",
    phone: "942 000 000",
    email: "hola@example.com",
    hours: "Lunes a viernes · 9:00 – 18:00",
  },
};

let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  getContact.mockResolvedValue({ ok: true, data: full });
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

describe("ContactScreen", () => {
  it("shows the site manager and the office of the home shown", async () => {
    render(<ContactScreen />);

    expect(screen.getByRole("header", { name: "Estamos contigo" })).toBeOnTheScreen();
    expect(await screen.findByText("Javier Ruiz")).toBeOnTheScreen();
    expect(getContact).toHaveBeenCalledWith("tok", "p1");
    expect(screen.getByText("Tu jefe de obra")).toBeOnTheScreen();
    expect(screen.getByText("JR")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Oficina ViTAH Santander" })).toBeOnTheScreen();
    expect(screen.getByText("Camargo, Cantabria")).toBeOnTheScreen();
    expect(screen.getByText("Lunes a viernes · 9:00 – 18:00")).toBeOnTheScreen();
    // No messaging and no site visits on the platform yet: not drawn.
    expect(screen.queryByText("Mensaje")).toBeNull();
    expect(screen.queryByText(/visita/i)).toBeNull();
  });

  it("calls and writes to the site manager", async () => {
    render(<ContactScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Llamar a Javier Ruiz" }));
    expect(openURL).toHaveBeenCalledWith("tel:+34600111222");
    expect(screen.getByText("Correo")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Escribir un email a Javier Ruiz" }));
    expect(openURL).toHaveBeenCalledWith("mailto:javier@example.com");
  });

  it("calls and writes to the office", async () => {
    render(<ContactScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Llamar a la oficina: 942 000 000" }));
    expect(openURL).toHaveBeenCalledWith("tel:942000000");
    fireEvent.press(screen.getByRole("button", { name: "Escribir un email a la oficina: hola@example.com" }));
    expect(openURL).toHaveBeenCalledWith("mailto:hola@example.com");
  });

  it("leaves out what the builder hasn't given", async () => {
    getContact.mockResolvedValue({
      ok: true,
      data: {
        siteManager: { name: "Javier Ruiz", phone: null, email: "javier@example.com" },
        office: { name: "ViTAH", address: null, phone: null, email: null, hours: "9:00 – 18:00" },
      },
    });
    render(<ContactScreen />);

    expect(await screen.findByText("Javier Ruiz")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Llamar/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Escribir un email a Javier Ruiz" })).toBeOnTheScreen();
    expect(screen.getByText("9:00 – 18:00")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /oficina/ })).toBeNull();
  });

  it("shows the office alone when no site manager is assigned", async () => {
    getContact.mockResolvedValue({ ok: true, data: { ...full, siteManager: null } });
    render(<ContactScreen />);

    expect(await screen.findByText("Camargo, Cantabria")).toBeOnTheScreen();
    expect(screen.queryByText("Tu jefe de obra")).toBeNull();
  });

  it("says plainly when there is nothing yet", async () => {
    getContact.mockResolvedValue({ ok: true, data: { siteManager: null, office: null } });
    render(<ContactScreen />);

    expect(await screen.findByText(/^Tu equipo de ViTAH todavía no ha añadido sus datos de contacto/)).toBeOnTheScreen();
  });

  it("opens a warranty claim from its last row", async () => {
    render(<ContactScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Abrir una solicitud de garantía" }));
    expect(mockNavigate).toHaveBeenCalledWith("/warranty");
  });

  it("says when the phone can't open the dialer", async () => {
    openURL.mockRejectedValue(new Error("no dialer"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<ContactScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Llamar a Javier Ruiz" }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("No hemos podido abrirlo en este teléfono: +34 600 111 222"),
    );
  });

  it("offers a retry when it can't load", async () => {
    getContact.mockResolvedValueOnce({ ok: false, error: "network_error" });
    render(<ContactScreen />);

    expect(await screen.findByText(/No hemos podido cargar el contacto/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Javier Ruiz")).toBeOnTheScreen();
  });

  it("signs out when the session was revoked", async () => {
    getContact.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<ContactScreen />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});

describe("contact helpers", () => {
  it("dials digits only", () => {
    expect(telUrl("+34 (942) 00-00-00")).toBe("tel:+34942000000");
  });

  it("writes initials", () => {
    expect(initials("Javier Ruiz García")).toBe("JR");
    expect(initials("obra@example.com")).toBe("O");
  });
});
