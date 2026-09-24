// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import ClientAccessCard from "./ClientAccessCard";

vi.mock("../../../../actions/project-client", () => ({
  createProjectClientAction: vi.fn(),
  resetProjectClientPasswordAction: vi.fn(),
  revokeProjectClientAction: vi.fn(),
}));
const actions = await import("../../../../actions/project-client");

const client = { id: "client-1", name: "Ana García", email: "ana@example.com" };

function renderCard(props: Partial<Parameters<typeof ClientAccessCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ClientAccessCard projectId="project-1" client={null} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.createProjectClientAction).mockReset();
  vi.mocked(actions.resetProjectClientPasswordAction).mockReset();
  vi.mocked(actions.revokeProjectClientAction).mockReset();
});

describe("ClientAccessCard without a client", () => {
  it("submits the grant-access form for this project", async () => {
    vi.mocked(actions.createProjectClientAction).mockResolvedValue({ success: true });
    renderCard();

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana García");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "client-pass");
    await userEvent.click(screen.getByRole("button", { name: "Dar acceso" }));

    await waitFor(() => expect(actions.createProjectClientAction).toHaveBeenCalled());
    const [projectId, , formData] = vi.mocked(actions.createProjectClientAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(Object.fromEntries(formData)).toEqual({
      name: "Ana García",
      email: "ana@example.com",
      password: "client-pass",
    });
  });

  it("shows a translated error", async () => {
    vi.mocked(actions.createProjectClientAction).mockResolvedValue({ error: "email_exists" });
    renderCard();

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "client-pass");
    await userEvent.click(screen.getByRole("button", { name: "Dar acceso" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Este email ya está en uso.");
  });
});

describe("ClientAccessCard with a client", () => {
  it("shows who has access", () => {
    renderCard({ client });

    expect(screen.getByText("Acceso activo")).toBeInTheDocument();
    expect(screen.getByText("Ana García")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
  });

  it("resets the password and confirms it", async () => {
    vi.mocked(actions.resetProjectClientPasswordAction).mockResolvedValue({ success: true });
    renderCard({ client });

    await userEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "brand-new-pass");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Contraseña actualizada.");
    const [projectId, , formData] = vi.mocked(actions.resetProjectClientPasswordAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(formData.get("password")).toBe("brand-new-pass");
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });

  it("keeps the reset form open on error", async () => {
    vi.mocked(actions.resetProjectClientPasswordAction).mockResolvedValue({
      error: "password_too_short",
    });
    renderCard({ client });

    await userEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("al menos 8 caracteres");
    expect(screen.getByLabelText("Nueva contraseña")).toBeInTheDocument();
  });

  it("cancels the reset form", async () => {
    renderCard({ client });

    await userEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });

  it("revokes access after confirmation", async () => {
    vi.mocked(actions.revokeProjectClientAction).mockResolvedValue({ success: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard({ client });

    await userEvent.click(screen.getByRole("button", { name: "Revocar acceso" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("ana@example.com"));
    await waitFor(() =>
      expect(actions.revokeProjectClientAction).toHaveBeenCalledWith("project-1"),
    );
  });

  it("does nothing when revocation is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard({ client });

    await userEvent.click(screen.getByRole("button", { name: "Revocar acceso" }));

    expect(actions.revokeProjectClientAction).not.toHaveBeenCalled();
  });

  it("shows a revoke error", async () => {
    vi.mocked(actions.revokeProjectClientAction).mockResolvedValue({ error: "no_client" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard({ client });

    await userEvent.click(screen.getByRole("button", { name: "Revocar acceso" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no tiene ningún cliente");
  });
});
