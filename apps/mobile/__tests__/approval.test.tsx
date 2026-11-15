import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import type { MobileApproval } from "@repo/core/contract";
import ApprovalScreen from "../app/(app)/aprobacion";
import { ApprovalCard } from "../components/approval-card";
import { api } from "../lib/api";
import { signedMoney } from "../lib/approval";
import { openDocumentCopy } from "../lib/hito-files";

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockReloadObra = jest.fn();
const mockOpenDocument = jest.fn();
let mockObra: object | undefined = { stage: 6 };
let mockDocuments: { id: string }[] = [];

jest.mock("../lib/use-project", () => {
  const { useMemo } = jest.requireActual<typeof import("react")>("react");
  const { useClientData } = jest.requireActual<typeof import("../lib/use-client-data")>("../lib/use-client-data");
  return {
    useProjectData: (fetch: (token: string, projectId: string) => never) =>
      useClientData(useMemo(() => (token: string) => fetch(token, "p1"), [fetch])),
  };
});
jest.mock("../lib/use-obra", () => ({ useObra: () => ({ obra: mockObra, reload: mockReloadObra }) }));
jest.mock("../lib/documents", () => ({ useDocuments: () => ({ documents: mockDocuments, open: mockOpenDocument }) }));
const mockSignOut = jest.fn();
jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: "tok", signOut: mockSignOut }) }));
jest.mock("../lib/api", () => ({ api: { getApproval: jest.fn(), decideApproval: jest.fn() } }));
jest.mock("../lib/hito-files", () => ({ openDocumentCopy: jest.fn() }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

const approval: MobileApproval = {
  id: "a1",
  revisionNumber: 2,
  reference: "036/2026",
  changeReason: "Piscina pedida por la propiedad",
  message: "Te enviamos la piscina que hablamos",
  askedAt: "2026-11-02T09:00:00.000Z",
  beforeCents: 21_000_000,
  afterCents: 21_500_000,
  differenceCents: 500_000,
  vatRateBp: 1000,
  documentId: "doc-7",
  changes: [{ number: 4, description: "Piscina en el jardín" }],
  options: [{ name: "Piscina", priceCents: 500_000 }],
};

const waiting = (value: MobileApproval | null = approval) =>
  jest.mocked(api.getApproval).mockResolvedValue({ ok: true, data: { approval: value } });

beforeEach(() => {
  jest.clearAllMocks();
  mockObra = { stage: 6 };
  mockDocuments = [];
  waiting();
});

describe("signedMoney", () => {
  it("says the sign of a difference", () => {
    expect(signedMoney(500_000)).toBe("+5000,00 €");
    expect(signedMoney(-120_000)).toBe("−1200,00 €");
    expect(signedMoney(0, "en")).toBe("€0.00");
  });
});

describe("ApprovalCard (Inicio)", () => {
  it("shows the change waiting and opens it", async () => {
    render(<ApprovalCard />);

    const card = await screen.findByRole("button", { name: /Cambio para aprobar · Rev\.2/ });
    expect(screen.getByText("Piscina pedida por la propiedad")).toBeOnTheScreen();
    expect(screen.getByText("+5000,00 € sobre tu contrato, sin IVA")).toBeOnTheScreen();
    expect(api.getApproval).toHaveBeenCalledWith("tok", "p1");

    fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith("/aprobacion");
  });

  it("shows nothing without one, nor when the server can't say", async () => {
    waiting(null);
    const { rerender } = render(<ApprovalCard />);
    await waitFor(() => expect(api.getApproval).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();

    // An older server has no such route.
    jest.mocked(api.getApproval).mockResolvedValue({ ok: false, error: "server_error" });
    rerender(<ApprovalCard />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reloads when the obra does: the server moved its counter", async () => {
    const { rerender } = render(<ApprovalCard />);
    await screen.findByText("Piscina pedida por la propiedad");

    waiting(null);
    mockObra = { stage: 6, reloaded: true };
    await act(async () => rerender(<ApprovalCard />));

    await waitFor(() => expect(api.getApproval).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Piscina pedida por la propiedad")).toBeNull(), { timeout: 5000 });
  });
});

describe("ApprovalScreen", () => {
  it("shows the reason, the message, the price before and after, what changes and the PDF", async () => {
    render(<ApprovalScreen />);

    expect(await screen.findByRole("header", { name: "¿Apruebas este cambio?" })).toBeOnTheScreen();
    expect(screen.getByText("Cambio en tu contrato · Rev.2")).toBeOnTheScreen();
    expect(screen.getByText("Piscina pedida por la propiedad")).toBeOnTheScreen();
    expect(screen.getByText("Te enviamos la piscina que hablamos")).toBeOnTheScreen();
    expect(screen.getByText("210.000,00 €")).toBeOnTheScreen();
    expect(screen.getByText("215.000,00 €")).toBeOnTheScreen();
    // The difference, and the pool's price.
    expect(screen.getAllByText("+5000,00 €")).toHaveLength(2);
    expect(screen.getByText("Piscina")).toBeOnTheScreen();
    expect(screen.getByText("Importes sin IVA. Con IVA (10 %), la diferencia es de +5500,00 €.")).toBeOnTheScreen();
    expect(screen.getByText(/Piscina en el jardín/)).toBeOnTheScreen();
    expect(screen.getByText("CAM-004")).toBeOnTheScreen();
    expect(screen.getByText("Presupuesto Rev.2")).toBeOnTheScreen();
  });

  it("approves with the client's password, and says so", async () => {
    jest.mocked(api.decideApproval).mockResolvedValue({
      ok: true,
      data: { approval: { id: "a1", status: "approved", decidedAt: "2026-11-03T10:00:00.000Z" } },
    });
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    // No password, nothing sent.
    fireEvent.press(screen.getByRole("button", { name: "Confirmar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Rellena el campo para continuar.");
    expect(api.decideApproval).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText("Tu contraseña"), "CasaNordica26");
    fireEvent.press(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("header", { name: "Has aprobado el cambio" })).toBeOnTheScreen();
    expect(api.decideApproval).toHaveBeenCalledWith("tok", "a1", { decision: "approve", password: "CasaNordica26" });
    expect(mockReloadObra).toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it.each([
    ["wrong_password", "La contraseña no es correcta."],
    ["too_many_attempts", "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo."],
    ["approval_closed", "Este cambio ya no está pendiente: tu equipo lo ha retirado o sustituido."],
    ["network_error", "No se ha podido enviar tu respuesta. Comprueba tu conexión."],
  ] as const)("keeps the request open on %s and says why", async (error, text) => {
    jest.mocked(api.decideApproval).mockResolvedValue({ ok: false, error });
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    fireEvent.changeText(screen.getByLabelText("Tu contraseña"), "nope");
    fireEvent.press(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("header", { name: "¿Apruebas este cambio?" })).toBeOnTheScreen();
  });

  it("reloads when the request was closed meanwhile, to show what is", async () => {
    jest.mocked(api.decideApproval).mockResolvedValue({ ok: false, error: "approval_closed" });
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    fireEvent.changeText(screen.getByLabelText("Tu contraseña"), "CasaNordica26");
    waiting(null);
    fireEvent.press(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("No tienes ningún cambio pendiente de aprobar.")).toBeOnTheScreen();
    expect(api.getApproval).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
  });

  it("forgets the password after a wrong one and after cancelling", async () => {
    jest.mocked(api.decideApproval).mockResolvedValue({ ok: false, error: "wrong_password" });
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    fireEvent.changeText(screen.getByLabelText("Tu contraseña"), "nope");
    fireEvent.press(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Tu contraseña")).toHaveDisplayValue("");

    fireEvent.changeText(screen.getByLabelText("Tu contraseña"), "CasaNordica26");
    fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.press(screen.getByRole("button", { name: "Aprobar" }));
    expect(screen.getByLabelText("Tu contraseña")).toHaveDisplayValue("");
  });

  it("starts afresh when the request is replaced by another", async () => {
    const { rerender } = render(<ApprovalScreen />);
    fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    fireEvent.changeText(screen.getByLabelText("Tu contraseña"), "CasaNordica26");

    waiting({ ...approval, id: "a2", revisionNumber: 3 });
    mockObra = { stage: 6, reloaded: true };
    await act(async () => rerender(<ApprovalScreen />));

    expect(await screen.findByText("Cambio en tu contrato · Rev.3")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Tu contraseña")).toBeNull();
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeOnTheScreen();
  });

  it("takes a reason only as long as the server does", async () => {
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Rechazar" }));

    expect(screen.getByLabelText("Motivo del rechazo").props.maxLength).toBe(1000);
  });

  it("rejects with a reason", async () => {
    jest.mocked(api.decideApproval).mockResolvedValue({
      ok: true,
      data: { approval: { id: "a1", status: "rejected", decidedAt: "2026-11-03T10:00:00.000Z" } },
    });
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Rechazar" }));
    fireEvent.changeText(screen.getByLabelText("Motivo del rechazo"), "  Es muy cara  ");
    fireEvent.press(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByRole("header", { name: "Has rechazado el cambio" })).toBeOnTheScreen();
    expect(api.decideApproval).toHaveBeenCalledWith("tok", "a1", { decision: "reject", reason: "Es muy cara" });
  });

  it("goes back to the request from either step", async () => {
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: "Rechazar" }));
    fireEvent.press(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Motivo del rechazo")).toBeNull();
  });

  it("opens the PDF from the phone's documents, else downloads it", async () => {
    mockDocuments = [{ id: "doc-7" }];
    mockOpenDocument.mockResolvedValue(true);
    render(<ApprovalScreen />);

    fireEvent.press(await screen.findByRole("button", { name: /Presupuesto Rev\.2/ }));
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledWith({ id: "doc-7" }));
    expect(openDocumentCopy).not.toHaveBeenCalled();

    mockOpenDocument.mockResolvedValue(false);
    fireEvent.press(screen.getByRole("button", { name: /Presupuesto Rev\.2/ }));
    await waitFor(() => expect(openDocumentCopy).toHaveBeenCalledWith("tok", "doc-7"));
  });

  it("tells the client when the PDF can't be opened", async () => {
    jest.mocked(openDocumentCopy).mockRejectedValue(new Error("offline"));
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<ApprovalScreen />);

    const pdf = await screen.findByRole("button", { name: /Presupuesto Rev\.2/ });
    await act(async () => fireEvent.press(pdf));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("No hemos podido abrir el documento. Comprueba tu conexión."));
  });

  it("says when nothing is waiting", async () => {
    waiting(null);
    render(<ApprovalScreen />);

    expect(await screen.findByText("No tienes ningún cambio pendiente de aprobar.")).toBeOnTheScreen();
  });
});
