// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/es.json";
import { TODAY, chapters, header, photo, photos } from "../../../../../../test/construction-fixture";
import PhotosScreen from "./PhotosScreen";

vi.mock("../../../../../actions/photos", () => ({
  addProjectPhotoAction: vi.fn(),
  deleteProjectPhotoAction: vi.fn(),
  setPhotoVisibilityAction: vi.fn(),
}));
const actions = await import("../../../../../actions/photos");

const options = chapters.map(({ code, name }) => ({ code, name }));

function renderScreen(props: Partial<Parameters<typeof PhotosScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <PhotosScreen projectId="p-1" header={header} photos={photos} chapters={options} today={TODAY} canManage {...props} />
    </NextIntlClientProvider>,
  );
}

const groups = () =>
  within(screen.getByRole("region", { name: "Fotos" }))
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent);

beforeEach(() => {
  vi.mocked(actions.addProjectPhotoAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.deleteProjectPhotoAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.setPhotoVisibilityAction).mockReset().mockResolvedValue({ success: true });
});

describe("PhotosScreen", () => {
  it("groups the photos by week, or by chapter", async () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Fotos de obra 3");
    expect(groups()).toEqual(["Esta semana · 16–17 oct", "8 oct"]);
    const photo = screen.getByRole("img", { name: "Fachada norte" });
    expect(photo).toHaveAttribute("src", "/api/v1/projects/p-1/photos/photo-1?size=thumb");
    expect(screen.getByRole("link", { name: "Descargar Fachada norte" })).toHaveAttribute("href", "/api/v1/projects/p-1/photos/photo-1");
    // Without a caption: the day it was taken.
    expect(screen.getByRole("img", { name: "Foto del 8 oct 2026" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Por capítulo" }));
    expect(groups()).toEqual(["06 · Envolvente térmica Thermochip", "04 · Albañilería y saneamiento", "Sin capítulo"]);
  });

  it("uploads every photo picked with the same date, caption and chapter", async () => {
    renderScreen();

    const form = within(screen.getByRole("form", { name: "Subir fotos" }));
    await userEvent.upload(form.getByLabelText(/Arrastra las fotos/), [
      new File(["a"], "a.jpg", { type: "image/jpeg", lastModified: Date.UTC(2026, 9, 15, 10) }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]);
    // The date comes from the first file.
    expect(form.getByLabelText("Fecha")).toHaveValue("2026-10-15");
    await userEvent.type(form.getByLabelText(/Descripción/), "Fachada sur");
    await userEvent.selectOptions(form.getByLabelText(/Capítulo/), "06");
    await userEvent.click(form.getByRole("button", { name: "Subir" }));

    await waitFor(() => expect(actions.addProjectPhotoAction).toHaveBeenCalledTimes(2));
    const sent = vi.mocked(actions.addProjectPhotoAction).mock.calls.map(([id, , data]) => [
      id,
      (data.get("file") as File).name,
      data.get("takenOn"),
      data.get("caption"),
      data.get("chapterCode"),
    ]);
    expect(sent).toEqual([
      ["p-1", "a.jpg", "2026-10-15", "Fachada sur", "06"],
      ["p-1", "b.png", "2026-10-15", "Fachada sur", "06"],
    ]);
  });

  it("stops and explains when an upload fails", async () => {
    vi.mocked(actions.addProjectPhotoAction).mockResolvedValue({ error: "invalid_date" });
    renderScreen();

    const form = within(screen.getByRole("form", { name: "Subir fotos" }));
    await userEvent.upload(form.getByLabelText(/Arrastra las fotos/), [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);
    await userEvent.click(form.getByRole("button", { name: "Subir" }));

    expect(await form.findByRole("alert")).toHaveTextContent("Introduce una fecha válida, no posterior a hoy.");
    expect(actions.addProjectPhotoAction).toHaveBeenCalledTimes(1);
  });

  it("refuses files that aren't photos before sending", async () => {
    renderScreen();
    const form = within(screen.getByRole("form", { name: "Subir fotos" }));
    await userEvent.upload(form.getByLabelText(/Arrastra las fotos/), new File(["a"], "plano.pdf", { type: "application/pdf" }), {
      applyAccept: false,
    });
    expect(form.getByRole("alert")).toHaveTextContent("Solo se admiten imágenes JPG, PNG o WebP.");
    expect(form.getByRole("button", { name: "Subir" })).toBeDisabled();
  });

  it("deletes a photo once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Eliminar Fachada norte" }));
    expect(actions.deleteProjectPhotoAction).toHaveBeenCalledWith("p-1", "photo-1");
  });

  it("hides a photo from the client's app, or shows a hidden one", async () => {
    renderScreen({ photos: [photo(), photo({ id: "photo-2", caption: "Tabiquería", visibleToClient: false })] });

    const shown = screen.getByRole("button", { name: "Visible en la app del cliente: Fachada norte" });
    expect(shown).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(shown);
    expect(actions.setPhotoVisibilityAction).toHaveBeenCalledWith("p-1", "photo-1", false);

    const hidden = screen.getByRole("button", { name: "Visible en la app del cliente: Tabiquería" });
    expect(hidden).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByText("Solo equipo")).toHaveLength(1);
    await userEvent.click(hidden);
    await waitFor(() => expect(actions.setPhotoVisibilityAction).toHaveBeenCalledWith("p-1", "photo-2", true));
  });

  it("explains when changing a photo fails", async () => {
    vi.mocked(actions.setPhotoVisibilityAction).mockResolvedValue({ error: "not_found" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Visible en la app del cliente: Fachada norte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Foto no encontrada.");
  });

  it("is read-only for viewers, who still see which photos are hidden", () => {
    renderScreen({ canManage: false, photos: [photo({ visibleToClient: false })] });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar|Visible en la app/ })).not.toBeInTheDocument();
    expect(screen.getByText("Solo equipo")).toBeInTheDocument();
  });
});
