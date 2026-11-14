// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletedItem, DeletedList } from "@repo/core/contract";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import EliminadosScreen from "./EliminadosScreen";

const listDeletedAction = vi.fn();
const restoreDeletedAction = vi.fn();
vi.mock("../../actions/deleted", () => ({
  listDeletedAction: (...args: unknown[]) => listDeletedAction(...args),
  restoreDeletedAction: (...args: unknown[]) => restoreDeletedAction(...args),
}));

const item = (overrides: Partial<DeletedItem> & Pick<DeletedItem, "kind" | "id" | "label">): DeletedItem => ({
  detail: null,
  day: null,
  amountCents: null,
  projectId: "p-1",
  projectRef: "VTH-26-001",
  deletedAt: "2026-11-14T09:02:00.000Z",
  deletedBy: { id: "u-1", name: "Laura Pérez" },
  restorable: true,
  parent: null,
  ...overrides,
});

const invoice = item({ kind: "invoice", id: "inv-1", label: "MSN-2026/112", detail: "Montajes Steel Norte S.L.", day: "2026-09-22", amountCents: 49_000 });
const payment = item({
  kind: "payment",
  id: "pay-1",
  label: "MSN-2026/112",
  detail: "Montajes Steel Norte S.L.",
  day: "2026-10-15",
  amountCents: 20_000,
  restorable: "parent_deleted",
  parent: { kind: "invoice", label: "MSN-2026/112" },
});
const photo = item({ kind: "photo", id: "ph-1", label: "2026-10-09", day: "2026-10-09", deletedBy: null });
const document = item({ kind: "document", id: "doc-1", label: "Contrato de obra", projectId: "p-2", projectRef: "VTH-26-002", restorable: "parent_deleted", parent: { kind: "project", label: "VTH-26-002" } });
const project = item({ kind: "project", id: "p-2", label: "VTH-26-002", detail: "Paseo de Pereda 3", projectId: "p-2", projectRef: "VTH-26-002", restorable: "ref_taken" });
const credit = item({ kind: "invoice", id: "inv-2", label: "R-7", detail: "Montajes Steel Norte S.L.", day: "2026-10-01", amountCents: -1_000, restorable: "duplicate_number" });

const projects = [
  { id: "p-1", ref: "VTH-26-001", deleted: false },
  { id: "p-2", ref: "VTH-26-002", deleted: true },
];

const page = (items: DeletedItem[], nextCursor: string | null = null): DeletedList => ({ items, nextCursor, projects });

function renderScreen(initial: DeletedList, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="Europe/Madrid">
      <EliminadosScreen initial={initial} />
    </NextIntlClientProvider>,
  );
}

/** The table's rows (the phone's cards hold the same items). */
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const rowOf = (text: string | RegExp) => within(screen.getByRole("table")).getByText(text).closest("tr")!;
const cards = () => within(screen.getByRole("region", { name: "Eliminados" })).getAllByRole("listitem");

beforeEach(() => {
  listDeletedAction.mockReset();
  restoreDeletedAction.mockReset();
});

describe("EliminadosScreen", () => {
  it("says what the page is and lists each record: what it is, its obra, when and who deleted it", () => {
    renderScreen(page([invoice, payment, photo, document, project, credit]));

    expect(screen.getByRole("heading", { level: 1, name: "Elementos eliminados" })).toBeInTheDocument();
    expect(screen.getByText(/Nada de lo que elimina un usuario se borra/)).toBeInTheDocument();
    expect(rows()).toHaveLength(6);
    // The same records as cards, for a phone.
    expect(cards()).toHaveLength(6);

    const invoiceRow = rowOf("Factura MSN-2026/112");
    expect(within(invoiceRow).getByText("Factura", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(within(invoiceRow).getByText(/Montajes Steel Norte S\.L\. · 490,00\s€ · 22 sept? 2026/)).toBeInTheDocument();
    expect(within(invoiceRow).getByText("VTH-26-001")).toBeInTheDocument();
    expect(within(invoiceRow).getByText("por Laura Pérez")).toBeInTheDocument();
    // 09:02 UTC is 10:02 in Spain.
    expect(within(invoiceRow).getByText(/14 nov 2026, 10:02/)).toBeInTheDocument();
    expect(within(invoiceRow).getByRole("button", { name: "Restaurar Factura MSN-2026/112" })).toBeInTheDocument();

    expect(rowOf(/Pago de 200,00\s€/)).toHaveTextContent(/15 oct 2026 · Factura MSN-2026\/112 · Montajes Steel Norte S\.L\./);
    // A photo without a caption goes by its day; whoever deleted it has no account any more.
    expect(rowOf("Foto del 9 oct 2026")).toHaveTextContent("por un usuario que ya no existe");
    expect(rowOf("Abono R-7")).toHaveTextContent(/−10,00\s€|-10,00\s€/);
    expect(within(rowOf("Paseo de Pereda 3")).getByText("Proyecto", { selector: "[data-slot=badge]" })).toBeInTheDocument();
  });

  it("says why a record can't be restored yet, instead of the button", () => {
    renderScreen(page([invoice, payment, document, project, credit]));

    expect(within(screen.getByRole("table")).getAllByRole("button", { name: /^Restaurar/ })).toHaveLength(1);
    const reason = (row: HTMLElement, text: string) => {
      expect(within(row).getByText(text)).toBeInTheDocument();
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    };
    reason(rowOf(/Pago de 200,00/), "Su factura MSN-2026/112 está eliminada: restáurala primero.");
    reason(rowOf("Contrato de obra"), "Su obra VTH-26-002 está eliminada: restáurala primero.");
    reason(rowOf("Paseo de Pereda 3"), "La referencia VTH-26-002 la usa ahora otro proyecto. Mientras sea así, no se puede restaurar.");
    reason(rowOf("Abono R-7"), "Ese proveedor tiene ahora otra factura con el número R-7. Cambia el número de esa para restaurar esta.");
    // On a phone too.
    expect(within(cards()[1]!).getByText("Su factura MSN-2026/112 está eliminada: restáurala primero.")).toBeInTheDocument();
  });

  it("has a plain empty state, and another when the filters leave nothing", async () => {
    listDeletedAction.mockResolvedValue({ data: { items: [], nextCursor: null, projects } });
    renderScreen({ items: [], nextCursor: null, projects: [] });

    expect(screen.getByText("No hay nada eliminado.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "photo");
    expect(await screen.findByText("No hay nada eliminado con estos filtros.")).toBeInTheDocument();
  });

  it("filters by kind and by obra on the server, a deleted obra marked as such", async () => {
    renderScreen(page([invoice, photo, document], "c-1"));
    const obra = screen.getByRole("combobox", { name: "Obra" });
    expect(within(obra).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todas", "VTH-26-001", "VTH-26-002 (eliminada)"]);
    expect(within(screen.getByRole("combobox", { name: "Tipo" })).getAllByRole("option")).toHaveLength(9);

    listDeletedAction.mockResolvedValueOnce({ data: page([photo]) });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "photo");
    expect(listDeletedAction).toHaveBeenLastCalledWith({ kind: "photo" });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rowOf("Foto del 9 oct 2026")).toBeInTheDocument();
    // The filtered list ends there.
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();

    listDeletedAction.mockResolvedValueOnce({ data: { items: [], nextCursor: null, projects: [projects[0]!] } });
    await userEvent.selectOptions(obra, "p-2");
    expect(listDeletedAction).toHaveBeenLastCalledWith({ kind: "photo", projectId: "p-2" });
    expect(await screen.findByText("No hay nada eliminado con estos filtros.")).toBeInTheDocument();
    // The obras are the server's latest.
    await waitFor(() => expect(within(obra).getAllByRole("option")).toHaveLength(2));

    listDeletedAction.mockResolvedValueOnce({ error: "invalid_input" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "");
    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido cargar la lista con esos filtros.");
  });

  it("loads more below what it shows, with the filters it has", async () => {
    renderScreen(page([invoice, photo], "c-1"));

    listDeletedAction.mockResolvedValueOnce({ data: { items: [photo, document], nextCursor: "c-2" } });
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(listDeletedAction).toHaveBeenLastCalledWith({ cursor: "c-1" });
    // Appended, and nothing twice.
    await waitFor(() => expect(rows()).toHaveLength(3));

    listDeletedAction.mockResolvedValueOnce({ data: { items: [project], nextCursor: null } });
    // The button reads "Cargando…" until the page is in.
    await userEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(listDeletedAction).toHaveBeenLastCalledWith({ cursor: "c-2" });
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
    // The obras came with the first page and stay.
    expect(within(screen.getByRole("combobox", { name: "Obra" })).getAllByRole("option")).toHaveLength(3);
  });

  it("asks before restoring, in a dialog; cancelling restores nothing", async () => {
    renderScreen(page([invoice, photo]));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Restaurar Factura MSN-2026/112" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "¿Restaurar Factura MSN-2026/112?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Vuelve a contar en los importes de su pedido, de la obra y del proveedor.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(restoreDeletedAction).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it("restores once confirmed: the row goes, it says so, and the list is read again", async () => {
    renderScreen(page([invoice, payment, photo], "c-1"));
    restoreDeletedAction.mockResolvedValue({ success: true });
    // What hung from the invoice can be restored now.
    listDeletedAction.mockResolvedValue({ data: page([{ ...payment, restorable: true, parent: null }, photo], "c-9") });

    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Restaurar Factura MSN-2026/112" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restaurar" }));

    expect(restoreDeletedAction).toHaveBeenCalledWith("invoice", "inv-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent("Restaurado: Factura MSN-2026/112.");
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(screen.getByRole("table")).queryByText("Factura MSN-2026/112")).not.toBeInTheDocument();
    // As many as were shown, from the top, with the filters in place.
    expect(listDeletedAction).toHaveBeenLastCalledWith({ limit: 3 });
    expect(within(rowOf(/Pago de 200,00/)).getByRole("button", { name: /^Restaurar/ })).toBeInTheDocument();
  });

  it("shows why a restore was refused, translated, and keeps the row", async () => {
    renderScreen(page([invoice, photo]));
    restoreDeletedAction.mockResolvedValueOnce({ error: "exceeds_amount" });

    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Restaurar Factura MSN-2026/112" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Restaurar" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Ya no cabe: supera lo que queda por pagar/);
    expect(listDeletedAction).not.toHaveBeenCalled();

    // A code it has no line for still says something; opening another record starts clean.
    restoreDeletedAction.mockResolvedValueOnce({ error: "something_new" });
    // The button reads "Restaurando…" until the answer is in.
    await userEvent.click(await within(dialog).findByRole("button", { name: "Restaurar" }));
    expect(await within(dialog).findByText("No se ha podido restaurar. Inténtalo de nuevo.")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(rows()).toHaveLength(2);
    await userEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Restaurar Foto del 9 oct 2026" }));
    expect(within(await screen.findByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads in English too", () => {
    renderScreen(page([invoice, document]), "en");
    expect(screen.getByRole("heading", { level: 1, name: "Deleted items" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByRole("button", { name: "Restore Invoice MSN-2026/112" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Its site VTH-26-002 is deleted: restore that first.")).toBeInTheDocument();
  });
});

describe("the messages", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix.slice(0, -1)];

  it("has every line of the page in both languages", () => {
    expect(keys(en.deletedPage)).toEqual(keys(es.deletedPage));
    expect(en.sidebar.deleted).toBeTruthy();
    expect(en.topbar.titles.deleted).toBeTruthy();
  });
});
