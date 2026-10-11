// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDocument } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import DocumentsScreen from "./DocumentsScreen";

vi.mock("../../../../actions/documents", () => ({
  addProjectDocumentAction: vi.fn(),
  deleteProjectDocumentAction: vi.fn(),
  setDocumentVisibilityAction: vi.fn(),
}));
const actions = await import("../../../../actions/documents");

const contract: ProjectDocument = {
  id: "doc-1",
  title: "Contrato de obra",
  category: "contract",
  sizeBytes: 3.1 * 1024 * 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
  uploadedBy: "Laura",
  visibleToClient: true,
  contentType: "application/pdf",
  filename: null,
  budgetInput: null,
  budgetPdf: null,
};
const measurements: ProjectDocument = {
  ...contract,
  id: "doc-2",
  title: "Mediciones",
  category: "budget",
  contentType: "application/octet-stream",
  filename: "mediciones.bc3",
  visibleToClient: false,
  budgetInput: "measurements",
};
const budgetPdf: ProjectDocument = {
  ...contract,
  id: "doc-3",
  title: "Presupuesto 041/2026 · Rev.0 · general",
  category: "budget",
  budgetPdf: "general",
};

function renderScreen(props: Partial<Parameters<typeof DocumentsScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <DocumentsScreen
        projectId="project-1"
        projectRef="VTH-26-001"
        documents={[contract]}
        canManage
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

async function openUpload() {
  await userEvent.click(screen.getByRole("button", { name: "Subir documento" }));
  return screen.findByRole("dialog", { name: "Subir documento" });
}

// jsdom treats a required file input as empty even after userEvent.upload, so
// its constraint validation would block the submit button; submit directly.
const submit = () =>
  fireEvent.submit(screen.getByRole("button", { name: "Subir" }).closest("form")!);

const pdf = (size = 10) =>
  new File(["%PDF-".padEnd(size, "x")], "Planos rev 3.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.mocked(actions.addProjectDocumentAction).mockReset();
  vi.mocked(actions.deleteProjectDocumentAction).mockReset();
  vi.mocked(actions.setDocumentVisibilityAction).mockReset();
});

describe("DocumentsScreen", () => {
  it("lists documents with a link to the file", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Documentos" })).toBeInTheDocument();
    expect(screen.getByText("VTH-26-001")).toBeInTheDocument();
    expect(screen.getByText("1 documento · 1 en la app del cliente")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Contrato de obra" });
    expect(link).toHaveAttribute("href", "/api/v1/projects/project-1/documents/doc-1");
    const row = link.closest("li")!;
    expect(within(row).getByText(/Contrato · 22 sept 2026 · 3,1 MB · Laura/)).toBeInTheDocument();
  });

  it("puts the budget's documents first, with their type and origin", () => {
    renderScreen({ documents: [contract, measurements, budgetPdf] });

    expect(screen.getByText("3 documentos · 2 en la app del cliente")).toBeInTheDocument();
    const [budget, other] = screen.getAllByRole("region");
    expect(within(budget!).getByRole("heading", { name: "Presupuesto" })).toBeInTheDocument();
    expect(within(budget!).getAllByRole("link").map((l) => l.textContent)).toEqual(["Mediciones", budgetPdf.title]);
    expect(within(budget!).getByText("BC3")).toBeInTheDocument();
    expect(within(budget!).getByText("Documentación del proyecto")).toBeInTheDocument();
    expect(within(budget!).getByText("PDF del presupuesto")).toBeInTheDocument();
    expect(within(other!).getByRole("heading", { name: "Otros documentos" })).toBeInTheDocument();
    expect(within(other!).getByRole("link", { name: "Contrato de obra" })).toBeInTheDocument();
  });

  it("never offers to delete an issued budget's PDF", () => {
    renderScreen({ documents: [budgetPdf, measurements] });

    expect(screen.queryByRole("button", { name: `Eliminar ${budgetPdf.title}` })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar Mediciones" })).toBeInTheDocument();
  });

  it("switches whether the client sees a document in the app", async () => {
    vi.mocked(actions.setDocumentVisibilityAction).mockResolvedValue({ success: true });
    const plans = { ...measurements, title: "Planos", contentType: "application/pdf", filename: "planos.pdf", budgetInput: "plans" as const };
    renderScreen({ documents: [contract, plans] });

    const hidden = screen.getByRole("button", { name: "Visible en la app del cliente: Planos" });
    expect(hidden).toHaveAttribute("aria-pressed", "false");
    expect(hidden).toHaveTextContent("Solo equipo");
    await userEvent.click(hidden);
    await userEvent.click(screen.getByRole("button", { name: "Visible en la app del cliente: Contrato de obra" }));

    await waitFor(() => expect(actions.setDocumentVisibilityAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(actions.setDocumentVisibilityAction).mock.calls).toEqual([
      ["project-1", "doc-2", true],
      ["project-1", "doc-1", false],
    ]);
  });

  it("offers no switch for a file the app can't open", () => {
    const bigPlans = { ...measurements, id: "doc-4", title: "Planos", contentType: "application/pdf", sizeBytes: 40 * 1024 * 1024 };
    renderScreen({ documents: [measurements, bigPlans] });

    expect(screen.queryByRole("button", { name: /Visible en la app/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Solo equipo")).toHaveLength(2);
  });

  it("shows read-only users which documents are staff only", () => {
    renderScreen({ documents: [measurements], canManage: false });

    expect(screen.queryByRole("button", { name: /Visible en la app/ })).not.toBeInTheDocument();
    expect(screen.getByText("Solo equipo")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderScreen({ documents: [] });

    expect(screen.getByRole("heading", { name: "Todavía no hay documentos" })).toBeInTheDocument();
    expect(screen.getByText(/Aquí solo vive una araña/)).toBeInTheDocument();
    expect(screen.getByText("Ningún documento")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("is read-only for users who can't manage documents", () => {
    renderScreen({ canManage: false });

    expect(screen.queryByRole("button", { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subir documento" })).not.toBeInTheDocument();
  });

  it("opens the upload form in a modal and cancels it", async () => {
    renderScreen();
    expect(screen.queryByLabelText("Archivo PDF")).not.toBeInTheDocument();

    const dialog = await openUpload();
    expect(within(dialog).getByLabelText("Archivo PDF")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("uploads a PDF, suggesting the title from the file name, then closes", async () => {
    vi.mocked(actions.addProjectDocumentAction).mockResolvedValue({ success: true });
    renderScreen();
    await openUpload();

    await userEvent.upload(screen.getByLabelText("Archivo PDF"), pdf());
    expect(screen.getByLabelText("Título")).toHaveValue("Planos rev 3");
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "Planos");
    submit();

    await waitFor(() => expect(actions.addProjectDocumentAction).toHaveBeenCalled());
    const [projectId, , formData] = vi.mocked(actions.addProjectDocumentAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(formData.get("title")).toBe("Planos rev 3");
    expect(formData.get("category")).toBe("plans");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rejects files over 4 MB before uploading", async () => {
    renderScreen();
    await openUpload();

    fireEvent.change(screen.getByLabelText("Archivo PDF"), {
      target: { files: [pdf(4 * 1024 * 1024 + 1)] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("supera el máximo de 4 MB");
    expect(screen.getByRole("button", { name: "Subir" })).toBeDisabled();
  });

  it("keeps the modal open with the error when the upload fails", async () => {
    vi.mocked(actions.addProjectDocumentAction).mockResolvedValue({ error: "invalid_file_type" });
    renderScreen();
    await openUpload();

    await userEvent.upload(screen.getByLabelText("Archivo PDF"), pdf());
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "Otros");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("no es un PDF válido");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("starts a fresh form when reopened after an error", async () => {
    vi.mocked(actions.addProjectDocumentAction).mockResolvedValue({ error: "invalid_file_type" });
    renderScreen();
    await openUpload();
    await userEvent.upload(screen.getByLabelText("Archivo PDF"), pdf());
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "Otros");
    submit();
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await openUpload();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("");
  });

  it("deletes after confirmation", async () => {
    vi.mocked(actions.deleteProjectDocumentAction).mockResolvedValue({ success: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar Contrato de obra" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("«Contrato de obra»"));
    await waitFor(() =>
      expect(actions.deleteProjectDocumentAction).toHaveBeenCalledWith("project-1", "doc-1"),
    );
  });

  it("does nothing when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar Contrato de obra" }));

    expect(actions.deleteProjectDocumentAction).not.toHaveBeenCalled();
  });
});
