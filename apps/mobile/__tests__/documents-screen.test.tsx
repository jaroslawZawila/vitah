import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import DocumentsScreen from "../app/(app)/documents";
import type { LocalDocument } from "../lib/document-store";
import { useDocuments } from "../lib/documents";

jest.mock("../lib/documents", () => ({ useDocuments: jest.fn() }));

const doc = (overrides: Partial<LocalDocument>): LocalDocument => ({
  id: "d1",
  title: "Contrato de obra",
  category: "contract",
  sizeBytes: 3.1 * 1024 * 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
  downloaded: true,
  isNew: false,
  ...overrides,
});

const contract = doc({ isNew: true });
const plans = doc({ id: "d2", title: "Planos rev. 3", category: "plans", sizeBytes: 180 * 1024 });

const sync = jest.fn();
const open = jest.fn();

function state(overrides: Partial<ReturnType<typeof useDocuments>> = {}) {
  jest.mocked(useDocuments).mockReturnValue({
    documents: [contract, plans],
    syncing: false,
    offline: false,
    sync,
    open,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  state();
});

describe("DocumentsScreen", () => {
  it("lists documents with date, size and the NUEVO badge", () => {
    render(<DocumentsScreen />);

    expect(screen.getByText("2 documentos")).toBeOnTheScreen();
    expect(screen.getByText("Contrato de obra")).toBeOnTheScreen();
    expect(screen.getByText("NUEVO")).toBeOnTheScreen();
    expect(screen.getByText(/^22 sept?\.? · 3,1 MB$/)).toBeOnTheScreen();
    expect(screen.getByText(/· 180 KB$/)).toBeOnTheScreen();
  });

  it("filters by category", () => {
    render(<DocumentsScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Planos" }));

    expect(screen.queryByText("Contrato de obra")).toBeNull();
    expect(screen.getByText("Planos rev. 3")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByText("Contrato de obra")).toBeOnTheScreen();
  });

  it("drops a filter whose last document was removed", () => {
    const { rerender } = render(<DocumentsScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Planos" }));

    state({ documents: [contract] });
    rerender(<DocumentsScreen />);

    expect(screen.getByText("Contrato de obra")).toBeOnTheScreen();
  });

  it("hides the category chips when there is only one category", () => {
    state({ documents: [contract] });
    render(<DocumentsScreen />);

    expect(screen.getByText("1 documento")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Todos" })).toBeNull();
  });

  it("opens a document", async () => {
    open.mockResolvedValue(true);
    render(<DocumentsScreen />);

    fireEvent.press(screen.getByText("Contrato de obra"));

    await waitFor(() => expect(open).toHaveBeenCalledWith(contract));
  });

  it("explains when a document hasn't been downloaded yet", async () => {
    open.mockResolvedValue(false);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    render(<DocumentsScreen />);

    fireEvent.press(screen.getByText("Contrato de obra"));

    await waitFor(() => expect(alert).toHaveBeenCalledWith("Documento no disponible", expect.any(String)));
    expect(sync).toHaveBeenCalled();
  });

  it("says when it is showing saved copies offline", () => {
    state({ offline: true });
    render(<DocumentsScreen />);

    expect(screen.getByText(/Sin conexión/)).toBeOnTheScreen();
  });

  it("shows a spinner on the first load", () => {
    state({ documents: undefined, syncing: true });
    render(<DocumentsScreen />);

    expect(screen.getByLabelText("Cargando tus documentos")).toBeOnTheScreen();
  });

  it("offers a retry when nothing could be loaded", () => {
    state({ documents: [], offline: true });
    render(<DocumentsScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));

    expect(sync).toHaveBeenCalled();
  });

  it("shows an empty state", () => {
    state({ documents: [] });
    render(<DocumentsScreen />);

    expect(screen.getByText(/Todavía no hay documentos/)).toBeOnTheScreen();
  });
});
