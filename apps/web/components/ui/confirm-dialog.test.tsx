// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

function Harness({
  pending = false,
  destructive = true,
  error,
  onConfirm = () => {},
}: {
  pending?: boolean;
  destructive?: boolean;
  error?: string;
  onConfirm?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Eliminar
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="¿Eliminar la factura MSN-148?"
        description="Sale de las listas y de los totales."
        confirmLabel="Eliminar factura"
        cancelLabel="Cancelar"
        pendingLabel="Un momento…"
        destructive={destructive}
        pending={pending}
        error={error && <p role="alert">{error}</p>}
        onConfirm={onConfirm}
      />
    </>
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "Eliminar" }));
  return screen.findByRole("alertdialog", { name: "¿Eliminar la factura MSN-148?" });
}

describe("ConfirmDialog", () => {
  it("names the record, says what happens and focuses Cancel", async () => {
    render(<Harness />);
    const dialog = await openDialog();

    expect(dialog).toHaveAccessibleDescription("Sale de las listas y de los totales.");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus());
  });

  it("runs the action only from its own button, labelled with the action", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const dialog = within(await openDialog());

    const confirm = dialog.getByRole("button", { name: "Eliminar factura" });
    expect(confirm.className).toContain("text-destructive");
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("styles a non-destructive action as the primary button", async () => {
    render(<Harness destructive={false} />);
    const dialog = within(await openDialog());

    expect(dialog.getByRole("button", { name: "Eliminar factura" }).className).toContain("bg-primary");
  });

  it("closes on Escape and on Cancel without running anything", async () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await openDialog();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    const dialog = within(await openDialog());
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("is modal: the page behind is hidden and inert while it is open", async () => {
    render(<Harness />);
    const dialog = await openDialog();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus());

    // Base UI traps the focus with guards and marks the rest of the page; jsdom
    // can't follow Tab through the guards, so this checks the marking.
    const behind = screen.getByText("Eliminar", { selector: "button" });
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(behind.closest("[inert], [aria-hidden='true']")).not.toBeNull();
  });

  it("while the action runs: says so, disables both buttons and ignores Escape", async () => {
    const { rerender } = render(<Harness />);
    await openDialog();
    rerender(<Harness pending />);

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Un momento…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Un momento…" })).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows the action's error inside the dialog", async () => {
    const { rerender } = render(<Harness />);
    await openDialog();
    rerender(<Harness error="No se pudo eliminar." />);

    expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toHaveTextContent("No se pudo eliminar.");
  });
});
