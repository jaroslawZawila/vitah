import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import SignInScreen from "../app/sign-in";

const mockAuth = {
  token: null as string | null,
  isLoading: false,
  biometric: false,
  signedOut: false,
  signIn: jest.fn(async () => ({})),
  signInWithBiometrics: jest.fn(async () => ({})),
};
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
jest.mock("expo-router", () => ({ Redirect: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockAuth, { token: null, biometric: false, signedOut: false });
});

describe("SignInScreen", () => {
  it("signs in with email and password", async () => {
    render(<SignInScreen />);

    fireEvent.changeText(screen.getByPlaceholderText("Email"), " ana@example.com ");
    fireEvent.changeText(screen.getByPlaceholderText("Contraseña"), "vitah2026");
    fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(mockAuth.signIn).toHaveBeenCalledWith("ana@example.com", "vitah2026"));
  });

  it("offers biometrics only when biometric access is on", () => {
    render(<SignInScreen />);

    expect(screen.queryByRole("button", { name: "Entrar con biometría" })).toBeNull();
    expect(mockAuth.signInWithBiometrics).not.toHaveBeenCalled();
  });

  it("asks for biometrics straight away when the app opens signed out", async () => {
    mockAuth.biometric = true;
    render(<SignInScreen />);

    await waitFor(() => expect(mockAuth.signInWithBiometrics).toHaveBeenCalledWith("Entrar en ViTAH"));
    expect(screen.getByRole("button", { name: "Entrar con biometría" })).toBeOnTheScreen();
  });

  it("waits for the button right after the client signed out", async () => {
    Object.assign(mockAuth, { biometric: true, signedOut: true });
    render(<SignInScreen />);

    expect(mockAuth.signInWithBiometrics).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Entrar con biometría" }));
    await waitFor(() => expect(mockAuth.signInWithBiometrics).toHaveBeenCalledTimes(1));
  });

  it("asks for the password when the saved session has expired", async () => {
    Object.assign(mockAuth, { biometric: true, signedOut: true });
    mockAuth.signInWithBiometrics.mockResolvedValueOnce({ error: "expired" } as never);
    render(<SignInScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Entrar con biometría" }));

    expect(await screen.findByText(/Tu sesión ha caducado/)).toBeOnTheScreen();
  });
});
