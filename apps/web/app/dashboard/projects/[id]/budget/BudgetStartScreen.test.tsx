// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetGeneration, ProjectDocument } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import BudgetStartScreen from "./BudgetStartScreen";

vi.mock("../../../../actions/budget", () => ({
  cancelGenerationAction: vi.fn(),
  getGenerationAction: vi.fn(),
  startGenerationAction: vi.fn(),
}));
vi.mock("../../../../actions/documents", () => ({
  budgetInputUploadAction: vi.fn(),
  deleteProjectDocumentAction: vi.fn(),
  markBudgetInputAction: vi.fn(),
  registerBudgetInputAction: vi.fn(),
}));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
const actions = await import("../../../../actions/budget");
const documents = await import("../../../../actions/documents");
const blob = await import("@vercel/blob/client");

const doc = (overrides: Partial<ProjectDocument>): ProjectDocument => ({
  id: "doc-1",
  title: "Planos",
  category: "budget",
  sizeBytes: 12 * 1024 * 1024,
  uploadedAt: "2026-10-01T10:00:00.000Z",
  uploadedBy: "Laura",
  visibleToClient: false,
  contentType: "application/pdf",
  filename: "Planos.pdf",
  budgetInput: "plans",
  budgetPdf: null,
  ...overrides,
});
const plans = doc({});
const contract = doc({ id: "doc-9", title: "Contrato", category: "contract", budgetInput: null, filename: null, visibleToClient: true });

const generation = (overrides: Partial<BudgetGeneration> = {}): BudgetGeneration => ({
  id: "gen-1",
  status: "running",
  step: 2,
  log: [
    { at: "2026-10-01T10:00:00.000Z", step: 0, kind: "done", code: "read", params: { files: 2 } },
    { at: "2026-10-01T10:01:00.000Z", step: 1, kind: "done", code: "analysed", params: { builtArea: 184.91, inconsistencies: 2 } },
  ],
  error: null,
  revisionId: null,
  facts: {
    promoter: "D. Roberto Guzmán Mesa",
    site: "Zarzalejo (Madrid)",
    architect: "Estudio Arboleda",
    typology: "Unifamiliar aislada",
    builtAreaM2: 184.91,
    usefulAreaM2: 139.7,
    windows: 14,
    bathrooms: 3,
    bedrooms: 4,
    inconsistencies: ["Carga de nieve: E1 frente a E4", "Altura libre en planta baja"],
  },
  createdAt: "2026-10-01T10:00:00.000Z",
  ...overrides,
});

function renderScreen(props: Partial<Parameters<typeof BudgetStartScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <BudgetStartScreen projectId="p-1" projectRef="VTH-26-001" generation={null} canManage inputs={[]} documents={[contract]} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  for (const fn of [...Object.values(actions), ...Object.values(documents)]) (fn as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
});

describe("BudgetStartScreen", () => {
  it("needs at least one document before the AI can start", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Sube la documentación del proyecto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar el borrador" })).toBeDisabled();
    expect(screen.getByText("Sube al menos un documento.")).toBeInTheDocument();
  });

  it("uploads a document straight to the store, then registers it", async () => {
    vi.mocked(documents.budgetInputUploadAction).mockResolvedValue({ pathname: "t/projects/p-1/inputs/abc.pdf" });
    vi.mocked(blob.upload).mockImplementation(async (_path, _file, options) => {
      options?.onUploadProgress?.({ loaded: 5, total: 10, percentage: 50 });
      return {} as never;
    });
    renderScreen();

    const file = new File(["%PDF-"], "Planos.pdf", { type: "application/pdf" });
    const [plansInput] = screen.getAllByLabelText("Subir archivo");
    await userEvent.upload(plansInput!, file);

    await waitFor(() => expect(documents.registerBudgetInputAction).toHaveBeenCalledWith("p-1", { pathname: "t/projects/p-1/inputs/abc.pdf", budgetInput: "plans", filename: "Planos.pdf" }));
    expect(documents.budgetInputUploadAction).toHaveBeenCalledWith("p-1", "Planos.pdf");
    expect(blob.upload).toHaveBeenCalledWith("t/projects/p-1/inputs/abc.pdf", file, expect.objectContaining({ access: "private", handleUploadUrl: "/api/v1/projects/p-1/documents/uploads" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows why an upload failed", async () => {
    vi.mocked(documents.budgetInputUploadAction).mockResolvedValue({ error: "invalid_file_type" });
    renderScreen();

    const [plansInput] = screen.getAllByLabelText("Subir archivo");
    await userEvent.upload(plansInput!, new File(["x"], "planos.pdf", { type: "application/pdf" }));

    expect(await screen.findByText(/Ese tipo de archivo no vale aquí: sube un PDF/)).toBeInTheDocument();
    expect(blob.upload).not.toHaveBeenCalled();
  });

  it("uses a document already on the project", async () => {
    renderScreen();

    const [choose] = screen.getAllByRole("combobox", { name: "Elegir de Documentos" });
    await userEvent.selectOptions(choose!, "Contrato");

    await waitFor(() => expect(documents.markBudgetInputAction).toHaveBeenCalledWith("p-1", "doc-9", "plans"));
  });

  it("starts the AI with the documents and settings", async () => {
    renderScreen({ inputs: [plans] });

    expect(screen.getByText(/Sin mediciones, la IA mide sobre los planos/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("N.º de presupuesto"), "041/2026");
    await userEvent.selectOptions(screen.getByLabelText("IVA"), "2100");
    await userEvent.click(screen.getByRole("button", { name: "Generar el borrador" }));

    await waitFor(() =>
      expect(actions.startGenerationAction).toHaveBeenCalledWith("p-1", { reference: "041/2026", quality: "framer", vatRateBp: 2100, documentIds: ["doc-1"] }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("removes a document", async () => {
    renderScreen({ inputs: [plans] });
    await userEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(documents.deleteProjectDocumentAction).toHaveBeenCalledWith("p-1", "doc-1");
  });

  it("words a document action's error for the budget's inputs", async () => {
    vi.mocked(documents.deleteProjectDocumentAction).mockResolvedValue({ error: "budget_document" });
    renderScreen({ inputs: [plans] });

    await userEvent.click(screen.getByRole("button", { name: "Quitar" }));

    expect(await screen.findByText("Este documento es del presupuesto: no se puede quitar.")).toBeInTheDocument();
  });

  it("explains a failed AI run", () => {
    renderScreen({ inputs: [plans], generation: generation({ status: "failed", error: "too_many_pages" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(/La IA no pudo terminar el borrador.*máximo 600 páginas/);
  });

  it("follows the AI's progress and shows the budget when it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(actions.getGenerationAction).mockResolvedValue(generation({ status: "succeeded", step: 5 }));
    renderScreen({ inputs: [plans], generation: generation() });

    expect(screen.getByRole("heading", { name: "Generando el borrador" })).toBeInTheDocument();
    expect(screen.getByText("Paso 3 de 6")).toBeInTheDocument();
    expect(screen.getByText(/184,91 m² construidos · 2 incoherencias/)).toBeInTheDocument();
    expect(screen.getByText("D. Roberto Guzmán Mesa")).toBeInTheDocument();
    expect(screen.getByText("Carga de nieve: E1 frente a E4")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(actions.getGenerationAction).toHaveBeenCalledWith("p-1", "gen-1");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("cancels the AI run", async () => {
    renderScreen({ inputs: [plans], generation: generation() });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(actions.cancelGenerationAction).toHaveBeenCalledWith("p-1", "gen-1");
  });

  it("is read-only for viewers", () => {
    renderScreen({ canManage: false, inputs: [plans] });

    expect(screen.queryByRole("button", { name: "Generar el borrador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Subir archivo")).not.toBeInTheDocument();
  });
});
