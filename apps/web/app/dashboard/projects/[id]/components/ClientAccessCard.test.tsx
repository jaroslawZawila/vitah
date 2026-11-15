// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import ClientAccessCard from "./ClientAccessCard";

vi.mock("../../../../actions/project-client", () => ({
  assignProjectClientAction: vi.fn(),
  unassignProjectClientAction: vi.fn(),
}));
const actions = await import("../../../../actions/project-client");

const ana = { id: "client-1", name: "Ana García", email: "ana@example.com" };
const luis = { id: "client-2", name: null, email: "luis@example.com" };

function renderCard(props: Partial<Parameters<typeof ClientAccessCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ClientAccessCard projectId="project-1" client={null} assignableClients={[]} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.assignProjectClientAction).mockReset();
  vi.mocked(actions.unassignProjectClientAction).mockReset();
});

describe("ClientAccessCard without a client", () => {
  it("points to the Clients tab when there is nobody to pick", () => {
    renderCard();

    expect(screen.getByRole("link", { name: "Clientes" })).toHaveAttribute(
      "href",
      "/dashboard/clients",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("assigns the picked client to this project", async () => {
    vi.mocked(actions.assignProjectClientAction).mockResolvedValue({ success: true });
    renderCard({ assignableClients: [ana, luis] });

    await userEvent.selectOptions(screen.getByLabelText("Cliente"), "luis@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Asignar cliente" }));

    await waitFor(() => expect(actions.assignProjectClientAction).toHaveBeenCalled());
    const [projectId, , formData] = vi.mocked(actions.assignProjectClientAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(formData.get("clientId")).toBe("client-2");
  });

  it("labels options with name and email", () => {
    renderCard({ assignableClients: [ana] });

    expect(screen.getByRole("option", { name: "Ana García — ana@example.com" })).toBeInTheDocument();
  });

  it("shows a translated error", async () => {
    vi.mocked(actions.assignProjectClientAction).mockResolvedValue({ error: "client_not_found" });
    renderCard({ assignableClients: [ana] });

    await userEvent.selectOptions(screen.getByLabelText("Cliente"), "client-1");
    await userEvent.click(screen.getByRole("button", { name: "Asignar cliente" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cliente no encontrado o inactivo.");
  });
});

describe("ClientAccessCard with a client", () => {
  it("shows who has access", () => {
    renderCard({ client: ana });

    expect(screen.getByText("Acceso activo")).toBeInTheDocument();
    expect(screen.getByText("Ana García")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  /** Quitar del proyecto: the dialog that asks, naming the client. */
  async function askToRemove() {
    await userEvent.click(screen.getByRole("button", { name: "Quitar del proyecto" }));
    return within(await screen.findByRole("alertdialog", { name: "¿Quitar a Ana García de este proyecto?" }));
  }

  it("removes the client after confirmation, saying the account stays", async () => {
    vi.mocked(actions.unassignProjectClientAction).mockResolvedValue({ success: true });
    renderCard({ client: ana });

    const dialog = await askToRemove();
    expect(dialog.getByText(/Su cuenta se mantiene, pero esta vivienda deja de aparecerle en la app/)).toBeInTheDocument();
    expect(actions.unassignProjectClientAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole("button", { name: "Quitar del proyecto" }));

    await waitFor(() =>
      expect(actions.unassignProjectClientAction).toHaveBeenCalledWith("project-1"),
    );
  });

  it("does nothing when removal is not confirmed", async () => {
    renderCard({ client: ana });

    const dialog = await askToRemove();
    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actions.unassignProjectClientAction).not.toHaveBeenCalled();
  });

  it("shows a removal error in the dialog", async () => {
    vi.mocked(actions.unassignProjectClientAction).mockResolvedValue({ error: "no_client" });
    renderCard({ client: ana });

    const dialog = await askToRemove();
    await userEvent.click(dialog.getByRole("button", { name: "Quitar del proyecto" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("no tiene ningún cliente");
  });
});
