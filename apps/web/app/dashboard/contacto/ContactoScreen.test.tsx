// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import ContactoScreen from "./ContactoScreen";

vi.mock("../../actions/contact", () => ({ updateOfficeContactAction: vi.fn() }));
const actions = await import("../../actions/contact");

const office = { address: "Camargo, Cantabria", phone: null, email: null, hours: null };

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ContactoScreen office={office} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(actions.updateOfficeContactAction).mockReset().mockResolvedValue({ success: true });
});

describe("Contacto para clientes", () => {
  it("shows the office as it is and saves the four fields", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "Contacto para clientes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dirección")).toHaveValue("Camargo, Cantabria");

    await userEvent.type(screen.getByLabelText("Teléfono"), "942 000 000");
    await userEvent.type(screen.getByLabelText("Horario"), "Lunes a viernes · 9:00 – 18:00");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actions.updateOfficeContactAction).toHaveBeenCalled());
    const [, formData] = vi.mocked(actions.updateOfficeContactAction).mock.calls[0]!;
    expect(Object.fromEntries(formData)).toEqual({
      address: "Camargo, Cantabria",
      phone: "942 000 000",
      email: "",
      hours: "Lunes a viernes · 9:00 – 18:00",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Datos de contacto guardados.");
  });

  it("shows a refusal", async () => {
    vi.mocked(actions.updateOfficeContactAction).mockResolvedValue({ error: "invalid_email" });
    renderScreen();

    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Introduce un email válido.");
  });

  it("keeps what was typed when the save is refused", async () => {
    vi.mocked(actions.updateOfficeContactAction).mockResolvedValue({ error: "invalid_email" });
    renderScreen();

    await userEvent.clear(screen.getByLabelText("Dirección"));
    await userEvent.type(screen.getByLabelText("Dirección"), "Santander");
    await userEvent.type(screen.getByLabelText("Email"), "a@b");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Introduce un email válido.");
    expect(screen.getByLabelText("Dirección")).toHaveValue("Santander");
    expect(screen.getByLabelText("Email")).toHaveValue("a@b");
  });
});
