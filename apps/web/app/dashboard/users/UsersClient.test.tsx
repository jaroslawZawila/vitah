// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import { UsersClient } from "./UsersClient";

vi.mock("../../actions/users", () => ({
  createUser: vi.fn(async () => null),
  updateUserRole: vi.fn(async () => ({})),
  toggleUserActive: vi.fn(async () => ({})),
  resetUserPasswordAction: vi.fn(async () => ({})),
  removeUserMfaAction: vi.fn(async () => ({})),
}));
const actions = await import("../../actions/users");

const laura = { id: "u-admin", name: "Laura", email: "laura@vitah.es", role: "admin", active: true, mfaEnabled: false, createdAt: "2026-09-01T10:00:00.000Z" } as const;
const marcos = { id: "u-marcos", name: "Marcos", email: "marcos@vitah.es", role: "viewer", active: true, mfaEnabled: false, createdAt: "2026-09-02T10:00:00.000Z" } as const;

type Row = Parameters<typeof UsersClient>[0]["users"][number];

function renderUsers(users: Row[] = [laura, marcos]) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <UsersClient users={users} currentUserId={laura.id} />
    </NextIntlClientProvider>,
  );
}

const openReset = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Restablecer contraseña de Marcos" }));
  return within(await screen.findByRole("dialog", { name: "Nueva contraseña para Marcos" }));
};

beforeEach(() => {
  vi.mocked(actions.resetUserPasswordAction).mockReset().mockResolvedValue({});
  vi.mocked(actions.removeUserMfaAction).mockReset().mockResolvedValue({});
});

describe("the Users page: resetting a password", () => {
  it("offers it on every row but the admin's own", () => {
    renderUsers();

    expect(screen.getByRole("button", { name: "Restablecer contraseña de Marcos" })).toBeEnabled();
    const own = screen.getByRole("button", { name: "Restablecer contraseña de Laura" });
    expect(own).toBeDisabled();
    expect(own).toHaveAttribute("title", "Tu propia contraseña se cambia desde Ajustes › Cambiar contraseña.");
  });

  it("sets the password the admin types and says whose sessions were closed", async () => {
    renderUsers();
    const dialog = await openReset();
    expect(dialog.getByLabelText("Nueva contraseña")).toHaveAccessibleDescription(
      "Mínimo 10 caracteres, con al menos una mayúscula y un número.",
    );
    expect(dialog.getByText(/no se volverá a mostrar/)).toBeInTheDocument();

    await userEvent.type(dialog.getByLabelText("Nueva contraseña"), "CasaNordica26");
    await userEvent.click(dialog.getByRole("button", { name: "Restablecer contraseña" }));

    await waitFor(() => expect(actions.resetUserPasswordAction).toHaveBeenCalledTimes(1));
    const [userId, form] = vi.mocked(actions.resetUserPasswordAction).mock.calls[0]!;
    expect(userId).toBe(marcos.id);
    expect(Object.fromEntries(form)).toEqual({ password: "CasaNordica26" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Contraseña de Marcos restablecida. Sus sesiones se han cerrado.",
    );
    // Closed, and the password is nowhere on the page.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent("CasaNordica26");
  });

  it("holds a password outside the policy back", async () => {
    renderUsers();
    const dialog = await openReset();

    await userEvent.type(dialog.getByLabelText("Nueva contraseña"), "casanordica26");
    await userEvent.click(dialog.getByRole("button", { name: "Restablecer contraseña" }));

    expect(dialog.getByRole("alert")).toHaveTextContent("La contraseña no cumple los requisitos");
    expect(actions.resetUserPasswordAction).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    vi.mocked(actions.resetUserPasswordAction).mockResolvedValue({ error: "forbidden" });
    renderUsers();
    const dialog = await openReset();

    await userEvent.type(dialog.getByLabelText("Nueva contraseña"), "CasaNordica26");
    await userEvent.click(dialog.getByRole("button", { name: "Restablecer contraseña" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Solo los administradores pueden gestionar usuarios.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes without changing anything on Cancelar", async () => {
    renderUsers();
    const dialog = await openReset();

    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.resetUserPasswordAction).not.toHaveBeenCalled();
  });

  it("asks for a password within the policy when inviting a user", async () => {
    renderUsers();
    await userEvent.click(screen.getByRole("button", { name: /Invitar Usuario/ }));

    const password = screen.getByLabelText("Contraseña temporal");
    expect(password).toHaveAttribute("minlength", "10");
    expect(password).toHaveAccessibleDescription("Mínimo 10 caracteres, con al menos una mayúscula y un número.");
  });
});

describe("the Users page: two-step verification", () => {
  const withMfa = [
    { ...laura, mfaEnabled: true },
    { ...marcos, mfaEnabled: true },
    { id: "u-ines", name: "Inés", email: "ines@vitah.es", role: "manager", active: true, mfaEnabled: false, createdAt: "2026-09-03T10:00:00.000Z" },
  ] satisfies Row[];
  const rowOf = (name: string) => within(screen.getByRole("cell", { name }).closest("tr")!);
  const openRemove = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Quitar verificación en dos pasos de Marcos" }));
    return within(await screen.findByRole("alertdialog", { name: "¿Quitar la verificación en dos pasos de Marcos?" }));
  };

  it("shows who has it on", () => {
    renderUsers(withMfa);

    expect(screen.getByRole("columnheader", { name: "2 pasos" })).toBeInTheDocument();
    expect(rowOf("Marcos").getByText("Activada")).toBeInTheDocument();
    expect(rowOf("Inés").queryByText("Activada")).not.toBeInTheDocument();
    expect(rowOf("Inés").getByText("No")).toBeInTheDocument();
  });

  it("offers removing it only where it is on, and never the admin's own", () => {
    renderUsers(withMfa);

    expect(screen.getByRole("button", { name: "Quitar verificación en dos pasos de Marcos" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Quitar verificación en dos pasos de Inés" })).not.toBeInTheDocument();
    const own = screen.getByRole("button", { name: "Quitar verificación en dos pasos de Laura" });
    expect(own).toBeDisabled();
    expect(own).toHaveAttribute(
      "title",
      "Tu propia verificación en dos pasos se desactiva desde Ajustes › Verificación en dos pasos.",
    );
  });

  it("asks first, then removes it and says whose sessions were closed", async () => {
    renderUsers(withMfa);
    const dialog = await openRemove();
    expect(dialog.getByText(/ha perdido el móvil/)).toBeInTheDocument();
    expect(dialog.getByText(/se cerrarán todas sus sesiones/)).toBeInTheDocument();
    expect(actions.removeUserMfaAction).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole("button", { name: "Quitar verificación en dos pasos" }));

    await waitFor(() => expect(actions.removeUserMfaAction).toHaveBeenCalledExactlyOnceWith(marcos.id));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Verificación en dos pasos de Marcos quitada. Sus sesiones se han cerrado.",
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("does nothing on Cancelar", async () => {
    renderUsers(withMfa);
    const dialog = await openRemove();

    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actions.removeUserMfaAction).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "Solo los administradores pueden gestionar usuarios."],
    ["mfa_not_enabled", "Este usuario no tiene activada la verificación en dos pasos."],
    ["not_found", "Usuario no encontrado."],
  ])("shows the server's refusal %s and stays open", async (error, text) => {
    vi.mocked(actions.removeUserMfaAction).mockResolvedValue({ error });
    renderUsers(withMfa);
    const dialog = await openRemove();

    await userEvent.click(dialog.getByRole("button", { name: "Quitar verificación en dos pasos" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("the Users page: deactivating a user", () => {
  beforeEach(() => {
    vi.mocked(actions.toggleUserActive).mockReset().mockResolvedValue({});
  });

  const askToDeactivate = async () => {
    const row = within(screen.getByRole("cell", { name: "Marcos" }).closest("tr")!);
    await userEvent.click(row.getByRole("button", { name: "Desactivar" }));
    return within(await screen.findByRole("alertdialog", { name: "¿Desactivar a Marcos?" }));
  };

  it("asks first, saying their sessions end, then deactivates", async () => {
    renderUsers();
    const dialog = await askToDeactivate();
    expect(dialog.getByText(/No podrá entrar en el portal y se cierran todas sus sesiones/)).toBeInTheDocument();
    expect(actions.toggleUserActive).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));

    await waitFor(() => expect(actions.toggleUserActive).toHaveBeenCalledExactlyOnceWith(marcos.id, false));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("does nothing on Cancelar, and shows a refusal in the dialog", async () => {
    vi.mocked(actions.toggleUserActive).mockResolvedValue({ error: "last_admin" });
    renderUsers();
    let dialog = await askToDeactivate();
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actions.toggleUserActive).not.toHaveBeenCalled();

    dialog = await askToDeactivate();
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar usuario" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("La organización debe tener al menos un administrador activo.");
  });

  it("activates an inactive user straight away: nothing is lost", async () => {
    renderUsers([laura, { ...marcos, active: false }]);
    await userEvent.click(screen.getByRole("button", { name: "Activar" }));
    expect(actions.toggleUserActive).toHaveBeenCalledWith(marcos.id, true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
