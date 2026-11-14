// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import ChangePasswordDialog, { type PasswordChangeResult } from "./ChangePasswordDialog";

// Pure: it takes the outcome of the change as a callback's answer.

function open(onSubmit: (form: FormData) => Promise<PasswordChangeResult> = vi.fn(async () => ({ success: true }))) {
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ChangePasswordDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />
    </NextIntlClientProvider>,
  );
  return { onSubmit, onOpenChange, dialog: within(screen.getByRole("dialog", { name: "Cambiar contraseña" })) };
}

async function fill(dialog: ReturnType<typeof open>["dialog"], current: string, next: string, repeat = next) {
  await userEvent.type(dialog.getByLabelText("Contraseña actual"), current);
  await userEvent.type(dialog.getByLabelText("Nueva contraseña"), next);
  await userEvent.type(dialog.getByLabelText("Repite la nueva contraseña"), repeat);
  await userEvent.click(dialog.getByRole("button", { name: "Cambiar contraseña" }));
}

describe("ChangePasswordDialog", () => {
  it("shows the policy under the new password, and what the change does", () => {
    const { dialog } = open();

    expect(dialog.getByLabelText("Nueva contraseña")).toHaveAccessibleDescription(
      "Mínimo 10 caracteres, con al menos una mayúscula y un número.",
    );
    expect(dialog.getByText(/se cierra tu sesión en los demás dispositivos/)).toBeInTheDocument();
    for (const label of ["Contraseña actual", "Nueva contraseña", "Repite la nueva contraseña"]) {
      expect(dialog.getByLabelText(label)).toHaveAttribute("type", "password");
    }
  });

  it("sends the current and the new password, then says it is done", async () => {
    const { dialog, onSubmit, onOpenChange } = open();

    await fill(dialog, "old-pass", "CasaNordica26");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(vi.mocked(onSubmit).mock.calls[0]![0])).toEqual({
      currentPassword: "old-pass",
      newPassword: "CasaNordica26",
    });
    expect(await dialog.findByRole("status")).toHaveTextContent(
      "Contraseña cambiada. Tu sesión se ha cerrado en los demás dispositivos.",
    );
    // The form, and what was typed in it, is gone.
    expect(dialog.queryByLabelText("Contraseña actual")).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Entendido" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks for the new password twice, the same", async () => {
    const { dialog, onSubmit } = open();

    await fill(dialog, "old-pass", "CasaNordica26", "CasaNordica27");

    expect(dialog.getByRole("alert")).toHaveTextContent("Las dos contraseñas nuevas no coinciden.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("holds a password outside the policy back", async () => {
    const { dialog, onSubmit } = open();

    await fill(dialog, "old-pass", "casanordica26");

    expect(dialog.getByRole("alert")).toHaveTextContent("La nueva contraseña no cumple los requisitos");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong_password", "La contraseña actual no es correcta."],
    ["same_password", "La nueva contraseña debe ser distinta de la actual."],
    ["too_many_attempts", "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo."],
    ["something_else", "No se ha podido cambiar la contraseña. Inténtalo de nuevo."],
  ])("shows the server's %s, keeping the form", async (error, text) => {
    const { dialog } = open(vi.fn(async () => ({ error })));

    await fill(dialog, "old-pass", "CasaNordica26");

    expect(await dialog.findByRole("alert")).toHaveTextContent(text);
    expect(dialog.getByLabelText("Contraseña actual")).toBeInTheDocument();
    expect(dialog.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sends the user to sign in again when this browser was signed out too", async () => {
    const { dialog } = open(vi.fn(async () => ({ success: true, signedOut: true })));

    await fill(dialog, "old-pass", "CasaNordica26");

    expect(await dialog.findByRole("status")).toHaveTextContent(
      "inicia sesión de nuevo con la nueva contraseña",
    );
    expect(dialog.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/");
  });
});
