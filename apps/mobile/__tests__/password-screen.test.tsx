import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import PasswordScreen from "../app/password";
import { api } from "../lib/api";

const mockBack = jest.fn();
const mockSignOut = jest.fn();
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", signOut: mockSignOut }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }), Redirect: () => null }));
jest.mock("../lib/api", () => ({ api: { changePassword: jest.fn() } }));

function fill(current: string, next: string, repeat = next) {
  fireEvent.changeText(screen.getByLabelText("CONTRASEÑA ACTUAL"), current);
  fireEvent.changeText(screen.getByLabelText("NUEVA CONTRASEÑA"), next);
  fireEvent.changeText(screen.getByLabelText("REPETIR NUEVA CONTRASEÑA"), repeat);
}
const save = () => fireEvent.press(screen.getByRole("button", { name: "GUARDAR" }));

beforeEach(() => jest.clearAllMocks());

describe("PasswordScreen", () => {
  it("rates the new password as it's typed", () => {
    render(<PasswordScreen />);

    fireEvent.changeText(screen.getByLabelText("NUEVA CONTRASEÑA"), "CasaNordica26");

    expect(screen.getByText("Seguridad alta")).toBeOnTheScreen();
  });

  it.each([
    ["missing fields", ["", "CasaNordica26"], /Rellena los tres campos/],
    ["a weak password", ["vitah2026", "casanordica"], /no cumple los requisitos/],
    ["a mismatch", ["vitah2026", "CasaNordica26", "CasaNordica27"], /no coinciden/],
  ])("checks %s before sending", (_name, [current, next, repeat], message) => {
    render(<PasswordScreen />);

    fill(current!, next!, repeat);
    save();

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("changes the password and goes back", async () => {
    jest.mocked(api.changePassword).mockResolvedValue({ ok: true, data: { success: true } });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<PasswordScreen />);

    fill("vitah2026", "CasaNordica26");
    save();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(api.changePassword).toHaveBeenCalledWith("tok", "vitah2026", "CasaNordica26");
    expect(alert).toHaveBeenCalledWith("Contraseña actualizada");
  });

  it("says when the current password is wrong", async () => {
    jest.mocked(api.changePassword).mockResolvedValue({ ok: false, error: "wrong_password" });
    render(<PasswordScreen />);

    fill("nope", "CasaNordica26");
    save();

    expect(await screen.findByRole("alert")).toHaveTextContent("La contraseña actual no es correcta.");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("says when the connection fails", async () => {
    jest.mocked(api.changePassword).mockResolvedValue({ ok: false, error: "network_error" });
    render(<PasswordScreen />);

    fill("vitah2026", "CasaNordica26");
    save();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Comprueba tu conexión/);
  });

  it("signs out when the session is no longer valid", async () => {
    jest.mocked(api.changePassword).mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<PasswordScreen />);

    fill("vitah2026", "CasaNordica26");
    save();

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });
});
