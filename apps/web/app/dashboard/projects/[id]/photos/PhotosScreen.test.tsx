// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectPhoto } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import PhotosScreen from "./PhotosScreen";

vi.mock("../../../../actions/photos", () => ({
  addProjectPhotoAction: vi.fn(),
  deleteProjectPhotoAction: vi.fn(),
}));
const actions = await import("../../../../actions/photos");

const facade: ProjectPhoto = {
  id: "photo-1",
  caption: "Fachada sur",
  sizeBytes: 2 * 1024 * 1024,
  uploadedAt: "2026-09-22T10:00:00.000Z",
  uploadedBy: "Laura",
};
const untitled: ProjectPhoto = {
  id: "photo-2",
  caption: null,
  sizeBytes: 1024,
  uploadedAt: "2026-09-08T10:00:00.000Z",
  uploadedBy: null,
};

function renderScreen(props: Partial<Parameters<typeof PhotosScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <PhotosScreen
        projectId="project-1"
        projectRef="VTH-26-001"
        photos={[facade, untitled]}
        canManage
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

async function openUpload() {
  await userEvent.click(screen.getByRole("button", { name: "Subir foto" }));
  return screen.findByRole("dialog", { name: "Subir foto" });
}

// jsdom treats a required file input as empty even after userEvent.upload.
const submit = () =>
  fireEvent.submit(screen.getByRole("button", { name: "Subir" }).closest("form")!);

const jpeg = (size = 10) =>
  new File([new Uint8Array(size)], "fachada.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.mocked(actions.addProjectPhotoAction).mockReset();
  vi.mocked(actions.deleteProjectPhotoAction).mockReset();
  // jsdom has no object URLs; the form uses one for the preview.
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("PhotosScreen", () => {
  it("shows thumbnails, each linking to the full-size image", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "Fotos" })).toBeInTheDocument();
    expect(screen.getByText("2 fotos")).toBeInTheDocument();
    const image = screen.getByRole("img", { name: "Fachada sur" });
    expect(image).toHaveAttribute("src", "/api/v1/projects/project-1/photos/photo-1?size=thumb");
    expect(image.closest("a")).toHaveAttribute("href", "/api/v1/projects/project-1/photos/photo-1");
    const tile = image.closest("li")!;
    expect(within(tile).getByText("22 sept 2026 · Laura")).toBeInTheDocument();
  });

  it("names a photo without a caption by its date", () => {
    renderScreen();

    expect(screen.getByRole("img", { name: "Foto del 8 sept 2026" })).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderScreen({ photos: [] });

    expect(screen.getByRole("heading", { name: "Todavía no hay fotos" })).toBeInTheDocument();
    expect(screen.getByText(/La cámara se ha echado la siesta/)).toBeInTheDocument();
    expect(screen.getByText("Ninguna foto")).toBeInTheDocument();
  });

  it("is read-only for users who can't manage photos", () => {
    renderScreen({ canManage: false });

    expect(screen.queryByRole("button", { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subir foto" })).not.toBeInTheDocument();
  });

  it("uploads a photo with a caption from the modal, then closes it", async () => {
    vi.mocked(actions.addProjectPhotoAction).mockResolvedValue({ success: true });
    renderScreen();
    const dialog = await openUpload();

    await userEvent.upload(within(dialog).getByLabelText("Imagen"), jpeg());
    expect(within(dialog).getByRole("img", { name: "Vista previa" })).toHaveAttribute(
      "src",
      "blob:preview",
    );
    await userEvent.type(within(dialog).getByLabelText("Pie de foto"), "Cubierta");
    submit();

    await waitFor(() => expect(actions.addProjectPhotoAction).toHaveBeenCalled());
    const [projectId, , formData] = vi.mocked(actions.addProjectPhotoAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(formData.get("caption")).toBe("Cubierta");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("only accepts JPG, PNG and WebP images", async () => {
    renderScreen();
    await openUpload();

    expect(screen.getByLabelText("Imagen")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
  });

  it("rejects images over 4 MB before uploading", async () => {
    renderScreen();
    await openUpload();

    fireEvent.change(screen.getByLabelText("Imagen"), {
      target: { files: [jpeg(4 * 1024 * 1024 + 1)] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("supera el máximo de 4 MB");
    expect(screen.getByRole("button", { name: "Subir" })).toBeDisabled();
  });

  it("keeps the modal open with the error when the upload fails", async () => {
    vi.mocked(actions.addProjectPhotoAction).mockResolvedValue({ error: "invalid_file_type" });
    renderScreen();
    await openUpload();

    await userEvent.upload(screen.getByLabelText("Imagen"), jpeg());
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("no es una imagen JPG, PNG o WebP");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the modal with the close button", async () => {
    renderScreen();
    await openUpload();

    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes after confirmation and shows errors", async () => {
    vi.mocked(actions.deleteProjectPhotoAction).mockResolvedValue({ error: "not_found" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar Fachada sur" }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(actions.deleteProjectPhotoAction).toHaveBeenCalledWith("project-1", "photo-1"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Foto no encontrada.");
  });

  it("does nothing when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Eliminar Fachada sur" }));

    expect(actions.deleteProjectPhotoAction).not.toHaveBeenCalled();
  });
});
