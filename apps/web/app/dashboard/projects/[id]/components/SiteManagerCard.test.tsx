// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import SiteManagerCard from "./SiteManagerCard";

vi.mock("../../../../actions/contact", () => ({ setSiteManagerAction: vi.fn() }));
const actions = await import("../../../../actions/contact");

const javier = { id: "u-1", name: "Javier Ruiz", email: "javier@example.com", phone: "+34 600 111 222" };
const marta = { id: "u-2", name: null, email: "marta@example.com", phone: null };

function renderCard(siteManager: typeof javier | null = null) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <SiteManagerCard projectId="project-1" data={{ siteManager, options: [javier, marta] }} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.setSiteManagerAction).mockReset().mockResolvedValue({ success: true });
});

describe("SiteManagerCard", () => {
  it("picks one of the staff, saying what the client will see", async () => {
    renderCard();
    const select = screen.getByLabelText("Persona del equipo");
    expect(select).toHaveValue("");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await userEvent.selectOptions(select, "Javier Ruiz — javier@example.com");
    expect(screen.getByText("Teléfono que verá el cliente: +34 600 111 222")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actions.setSiteManagerAction).toHaveBeenCalled());
    const [projectId, , formData] = vi.mocked(actions.setSiteManagerAction).mock.calls[0]!;
    expect(projectId).toBe("project-1");
    expect(formData.get("userId")).toBe("u-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Jefe de obra guardado.");
  });

  it("warns when the one picked has no phone, and can clear the one there is", async () => {
    renderCard(javier);
    expect(screen.getByLabelText("Persona del equipo")).toHaveValue("u-1");

    await userEvent.selectOptions(screen.getByLabelText("Persona del equipo"), "marta@example.com");
    expect(screen.getByText(/No tiene teléfono/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Persona del equipo"), "Sin jefe de obra");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(actions.setSiteManagerAction).toHaveBeenCalled());
    expect(vi.mocked(actions.setSiteManagerAction).mock.calls[0]![2].get("userId")).toBe("");
  });

  it("shows a refusal", async () => {
    vi.mocked(actions.setSiteManagerAction).mockResolvedValue({ error: "user_not_found" });
    renderCard();

    await userEvent.selectOptions(screen.getByLabelText("Persona del equipo"), "marta@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ese usuario ya no está activo. Elige otro.");
  });

  it("stops saying it was saved once another person is picked", async () => {
    renderCard();
    await userEvent.selectOptions(screen.getByLabelText("Persona del equipo"), "Javier Ruiz — javier@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Jefe de obra guardado.");

    await userEvent.selectOptions(screen.getByLabelText("Persona del equipo"), "marta@example.com");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
