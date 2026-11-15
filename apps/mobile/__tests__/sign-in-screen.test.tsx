import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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

  function submit() {
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "ana@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Contraseña"), "guess");
    fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));
  }

  // Each failure says what it was: only a rejected password reads as one.
  it.each([
    ["invalid_credentials", "Email o contraseña incorrectos"],
    ["unauthorized", "Email o contraseña incorrectos"],
    ["too_many_attempts", "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo."],
    ["network_error", "No hay conexión con ViTAH. Comprueba tu conexión a internet e inténtalo de nuevo."],
    ["timeout", "ViTAH está tardando demasiado en responder. Inténtalo de nuevo en unos instantes."],
    ["server_error", "Tenemos un problema en nuestros servidores. Inténtalo de nuevo más tarde."],
    // A code this version doesn't know, or one that names something on every object.
    ["email_and_password_required", "No hemos podido iniciar sesión. Inténtalo de nuevo."],
    ["constructor", "No hemos podido iniciar sesión. Inténtalo de nuevo."],
  ])("says what went wrong after %s", async (error, message) => {
    mockAuth.signIn.mockResolvedValueOnce({ error } as never);

    submit();

    expect(await screen.findByText(message)).toBeOnTheScreen();
    if (!message.startsWith("Email o contraseña")) {
      expect(screen.queryByText("Email o contraseña incorrectos")).toBeNull();
    }
    // Ready for another try.
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
  });

  it("stops waiting and says so when signing in throws", async () => {
    mockAuth.signIn.mockRejectedValueOnce(new Error("SecureStore unavailable"));

    submit();

    expect(await screen.findByText("No hemos podido iniciar sesión. Inténtalo de nuevo.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
  });

  it("clears the last error while it tries again", async () => {
    mockAuth.signIn.mockResolvedValueOnce({ error: "network_error" } as never);
    submit();
    await screen.findByText(/No hay conexión con ViTAH/);
    let finish!: (result: object) => void;
    mockAuth.signIn.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never);

    fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(screen.queryByText(/No hay conexión con ViTAH/)).toBeNull());
    await act(async () => finish({}));
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

  it("explains, on asking, that the builder sets a new password", () => {
    render(<SignInScreen />);
    const help = /Tu equipo de ViTAH puede asignarte una contraseña nueva/;
    const link = screen.getByRole("button", { name: "¿Has olvidado tu contraseña?" });
    expect(screen.queryByText(help)).toBeNull();

    fireEvent.press(link);
    expect(screen.getByText(help)).toBeOnTheScreen();
    expect(link).toBeExpanded();

    fireEvent.press(link);
    expect(screen.queryByText(help)).toBeNull();
    expect(mockAuth.signIn).not.toHaveBeenCalled();
  });
});
