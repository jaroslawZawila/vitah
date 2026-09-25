// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
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
    vi.mocked(actions.assignProjectClientAction).mockResolvedValue({ error: "client_has_project" });
    renderCard({ assignableClients: [ana] });

    await userEvent.selectOptions(screen.getByLabelText("Cliente"), "client-1");
    await userEvent.click(screen.getByRole("button", { name: "Asignar cliente" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ya está asignado a otro proyecto");
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

  it("removes the client after confirmation", async () => {
    vi.mocked(actions.unassignProjectClientAction).mockResolvedValue({ success: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard({ client: ana });

    await userEvent.click(screen.getByRole("button", { name: "Quitar del proyecto" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("ana@example.com"));
    await waitFor(() =>
      expect(actions.unassignProjectClientAction).toHaveBeenCalledWith("project-1"),
    );
  });

  it("does nothing when removal is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderCard({ client: ana });

    await userEvent.click(screen.getByRole("button", { name: "Quitar del proyecto" }));

    expect(actions.unassignProjectClientAction).not.toHaveBeenCalled();
  });

  it("shows a removal error", async () => {
    vi.mocked(actions.unassignProjectClientAction).mockResolvedValue({ error: "no_client" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderCard({ client: ana });

    await userEvent.click(screen.getByRole("button", { name: "Quitar del proyecto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no tiene ningún cliente");
  });
});
