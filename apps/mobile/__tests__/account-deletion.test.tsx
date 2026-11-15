import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import AccountDeletionScreen from "../app/account-deletion";
import { linkOf } from "../constants/links";
import { api } from "../lib/api";

const mockBack = jest.fn();
const mockAuth = { token: "tok" as string | null, signOut: jest.fn() };
jest.mock("../lib/auth", () => ({ useAuth: () => mockAuth }));
jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const { createElement } = jest.requireActual<typeof import("react")>("react");
    const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
    return createElement(Text, null, `redirect to ${href}`);
  },
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock("../lib/api", () => ({ api: { requestDeletion: jest.fn() } }));

const requestDeletion = jest.mocked(api.requestDeletion);
const ask = () => fireEvent.press(screen.getByRole("button", { name: "Solicitar la baja" }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.token = "tok";
});

describe("AccountDeletionScreen", () => {
  it("says what happens: the builder is told, documents may be kept, it can be withdrawn", () => {
    render(<AccountDeletionScreen />);

    expect(screen.getByRole("header", { name: "Solicitar la baja" })).toBeOnTheScreen();
    expect(screen.getByText(/Avisaremos a tu equipo de ViTAH/)).toBeOnTheScreen();
    expect(screen.getByText(/puedes retirar la solicitud en Perfil/)).toBeOnTheScreen();
    expect(screen.getByText(/plazo que marca la ley/)).toBeOnTheScreen();
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it("asks on confirm, then goes back to Perfil", async () => {
    requestDeletion.mockResolvedValue({ ok: true, data: { deletionRequestedAt: "2026-11-15T08:00:00.000Z" } });
    render(<AccountDeletionScreen />);

    ask();

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(requestDeletion).toHaveBeenCalledWith("tok");
  });

  it("stays and says so when the request can't be sent", async () => {
    requestDeletion.mockResolvedValue({ ok: false, error: "network_error" });
    render(<AccountDeletionScreen />);

    ask();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido enviar la solicitud. Comprueba tu conexión.");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("signs out when the session was revoked", async () => {
    requestDeletion.mockResolvedValue({ ok: false, error: "unauthorized" });
    render(<AccountDeletionScreen />);

    ask();

    await waitFor(() => expect(mockAuth.signOut).toHaveBeenCalled());
  });

  it("sends a signed-out phone to sign in", () => {
    mockAuth.token = null;
    render(<AccountDeletionScreen />);

    expect(screen.getByText("redirect to /sign-in")).toBeOnTheScreen();
  });
});

describe("linkOf (Perfil's help and privacy pages)", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["  ", null],
    ["http://vitah.es/privacidad", null],
    ["javascript:alert(1)", null],
    ["https://vitah.es/a b", null],
    [" https://vitah.es/privacidad ", "https://vitah.es/privacidad"],
  ])("%j → %j", (value, link) => {
    expect(linkOf(value)).toBe(link);
  });
});
