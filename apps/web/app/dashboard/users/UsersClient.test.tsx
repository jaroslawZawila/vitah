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
}));
const actions = await import("../../actions/users");

const laura = { id: "u-admin", name: "Laura", email: "laura@vitah.es", role: "admin", active: true, createdAt: "2026-09-01T10:00:00.000Z" } as const;
const marcos = { id: "u-marcos", name: "Marcos", email: "marcos@vitah.es", role: "viewer", active: true, createdAt: "2026-09-02T10:00:00.000Z" } as const;

function renderUsers() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <UsersClient users={[laura, marcos]} currentUserId={laura.id} />
    </NextIntlClientProvider>,
  );
}

const openReset = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Restablecer contraseña de Marcos" }));
  return within(await screen.findByRole("dialog", { name: "Nueva contraseña para Marcos" }));
};

beforeEach(() => {
  vi.mocked(actions.resetUserPasswordAction).mockReset().mockResolvedValue({});
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
