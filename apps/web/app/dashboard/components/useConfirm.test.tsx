// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import { useConfirm, type ConfirmRequest } from "./useConfirm";

function Harness(request: Pick<ConfirmRequest, "action" | "onDone">) {
  const confirm = useConfirm("usersPage.errors");
  return (
    <>
      <button
        type="button"
        onClick={() =>
          confirm.ask({
            title: "¿Desactivar a Ana?",
            description: "Sus sesiones se cierran.",
            confirmLabel: "Desactivar usuario",
            destructive: true,
            ...request,
          })
        }
      >
        Desactivar
      </button>
      {confirm.dialog}
    </>
  );
}

function renderHarness(request: Pick<ConfirmRequest, "action" | "onDone">) {
  render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <Harness {...request} />
    </NextIntlClientProvider>,
  );
}

async function ask() {
  await userEvent.click(screen.getByRole("button", { name: "Desactivar" }));
  return within(await screen.findByRole("alertdialog", { name: "¿Desactivar a Ana?" }));
}

describe("useConfirm", () => {
  it("runs the action only once confirmed, then closes and calls onDone", async () => {
    const action = vi.fn(async () => ({ success: true }));
    const onDone = vi.fn();
    renderHarness({ action, onDone });

    const dialog = await ask();
    expect(action).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));

    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does nothing when cancelled", async () => {
    const action = vi.fn(async () => ({ success: true }));
    renderHarness({ action });

    const dialog = await ask();
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(action).not.toHaveBeenCalled();
  });

  it("shows it is working while the action runs", async () => {
    let finish: (value: { success: boolean }) => void = () => {};
    const action = vi.fn(() => new Promise<{ success: boolean }>((resolve) => (finish = resolve)));
    renderHarness({ action });

    const dialog = await ask();
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));

    expect(await dialog.findByRole("button", { name: "Un momento…" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    finish({ success: true });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open with the action's error, translated, and can try again", async () => {
    const action = vi
      .fn<() => Promise<{ error?: string; success?: boolean }>>()
      .mockResolvedValueOnce({ error: "last_admin" })
      .mockResolvedValueOnce({ success: true });
    const onDone = vi.fn();
    renderHarness({ action, onDone });

    const dialog = await ask();
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("La organización debe tener al menos un administrador activo.");
    expect(onDone).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("falls back to the namespace's generic line for an unknown error", async () => {
    renderHarness({ action: async () => ({ error: "something_new" }) });

    const dialog = await ask();
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Error al procesar la solicitud.");
  });

  it("reads its text from the messages under a key, with the keep button when asked", async () => {
    function KeyHarness() {
      const t = useTranslations("purchasing.order");
      const confirm = useConfirm("purchasing.errors");
      return (
        <>
          <button
            type="button"
            onClick={() =>
              confirm.ask({ t, key: "cancelDialog", values: { number: "PED-004" }, keep: true, destructive: true, action: async () => ({ success: true }) })
            }
          >
            Cancelar pedido
          </button>
          {confirm.dialog}
        </>
      );
    }
    render(
      <NextIntlClientProvider locale="es" messages={messages}>
        <KeyHarness />
      </NextIntlClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    const dialog = within(await screen.findByRole("alertdialog", { name: "¿Cancelar el pedido PED-004?" }));
    expect(dialog.getByText(/^Deja de sumar a lo contratado/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Mantener pedido" })).toBeInTheDocument();
  });
});
