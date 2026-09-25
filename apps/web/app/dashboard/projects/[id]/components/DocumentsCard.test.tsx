// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDocument } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import DocumentsCard from "./DocumentsCard";

vi.mock("../../../../actions/documents", () => ({
  addProjectDocumentAction: vi.fn(),
  deleteProjectDocumentAction: vi.fn(),
}));
const actions = await import("../../../../actions/documents");

const contract: ProjectDocument = {
  id: "doc-1",
  title: "Contrato de obra",
  category: "contract",
  sizeBytes: 3.1 * 1024 * 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
  uploadedBy: "Laura",
};

function renderCard(props: Partial<Parameters<typeof DocumentsCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <DocumentsCard projectId="project-1" documents={[contract]} canManage {...props} />
    </NextIntlClientProvider>,
  );
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
});

describe("DocumentsCard", () => {
  it("lists documents with a link to the file", () => {
    renderCard();

    const link = screen.getByRole("link", { name: "Contrato de obra" });
    expect(link).toHaveAttribute("href", "/api/v1/projects/project-1/documents/doc-1");
    const row = link.closest("li")!;
    expect(within(row).getByText(/Contrato · 22 sept 2026 · 3,1 MB · Laura/)).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderCard({ documents: [] });

    expect(screen.getByText(/Todavía no hay documentos/)).toBeInTheDocument();
  });

  it("is read-only for users who can't manage documents", () => {
    renderCard({ canManage: false });

    expect(screen.queryByRole("button", { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Archivo PDF")).not.toBeInTheDocument();
  });

  it("uploads a PDF, suggesting the title from the file name", async () => {
    vi.mocked(actions.addProjectDocumentAction).mockResolvedValue({ success: true });
    renderCard();

    await userEvent.upload(screen.getByLabelText("Archivo PDF"), pdf());
    expect(screen.getByLabelText("Título")).toHaveValue("Planos rev 3");
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "Planos");
    submit();

    await waitFor(() => expect(actions.addProjectDocumentAction).toHaveBeenCalled());
    const [projectId, , formData] = vi.mocked(actions.addProjectDocumentAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(formData.get("title")).toBe("Planos rev 3");
    expect(formData.get("category")).toBe("plans");
    // jsdom's FormData leaves out uploaded files; the route tests send real ones.
    expect((screen.getByLabelText("Archivo PDF") as HTMLInputElement).files?.[0]?.name).toBe(
      "Planos rev 3.pdf",
    );
  });

  it("rejects files over 4 MB before uploading", async () => {
    renderCard();

    fireEvent.change(screen.getByLabelText("Archivo PDF"), {
      target: { files: [pdf(4 * 1024 * 1024 + 1)] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("supera el máximo de 4 MB");
    expect(screen.getByRole("button", { name: "Subir" })).toBeDisabled();
  });

  it("shows upload errors", async () => {
    vi.mocked(actions.addProjectDocumentAction).mockResolvedValue({ error: "invalid_file_type" });
    renderCard();

    await userEvent.upload(screen.getByLabelText("Archivo PDF"), pdf());
    await userEvent.selectOptions(screen.getByLabelText("Categoría"), "Otros");
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("no es un PDF válido");
  });

  it("deletes after confirmation", async () => {
    vi.mocked(actions.deleteProjectDocumentAction).mockResolvedValue({ success: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar Contrato de obra" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("«Contrato de obra»"));
    await waitFor(() =>
      expect(actions.deleteProjectDocumentAction).toHaveBeenCalledWith("project-1", "doc-1"),
    );
  });

  it("does nothing when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar Contrato de obra" }));

    expect(actions.deleteProjectDocumentAction).not.toHaveBeenCalled();
  });
});
