// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ClientListItem } from "@repo/core/contract";
import messages from "../../../../messages/es.json";
import ClientForm from "./ClientForm";
import ClientList from "./ClientList";

// The views are pure: they take data and callbacks, so no mocks are needed.

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

const ana: ClientListItem = {
  id: "client-1",
  email: "ana@example.com",
  firstName: "Ana",
  surnames: "García López",
  dateOfBirth: "1985-04-12",
  address: "Calle del Sol 5",
  phone: "+34 600 123 456",
  active: true,
  createdAt: "2026-09-01T10:00:00.000Z",
};

describe("ClientForm", () => {
  it("submits every field to the action", async () => {
    const action = vi.fn();
    wrap(<ClientForm action={action} pending={false} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Apellidos"), "García López");
    await userEvent.type(screen.getByLabelText("Fecha de nacimiento"), "1985-04-12");
    await userEvent.type(screen.getByLabelText("Teléfono"), "+34 600 123 456");
    await userEvent.type(screen.getByLabelText("Dirección"), "Calle del Sol 5");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña de la app"), "client-pass");
    await userEvent.click(screen.getByRole("button", { name: "Crear cliente" }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(action.mock.calls[0]![0] as FormData)).toEqual({
      firstName: "Ana",
      surnames: "García López",
      dateOfBirth: "1985-04-12",
      phone: "+34 600 123 456",
      address: "Calle del Sol 5",
      email: "ana@example.com",
      password: "client-pass",
    });
  });

  it("shows a translated error", () => {
    wrap(<ClientForm action={vi.fn()} pending={false} error="email_exists" onCancel={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Este email ya está en uso.");
  });
});

describe("ClientList", () => {
  it("shows the client's details", () => {
    wrap(<ClientList clients={[ana]} onSetPassword={() => {}} />);

    expect(screen.getByText("Ana García López")).toBeInTheDocument();
    expect(screen.getByText("+34 600 123 456")).toBeInTheDocument();
    expect(screen.getByText("Calle del Sol 5")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("asks to set the password of the chosen client", async () => {
    const onSetPassword = vi.fn();
    wrap(<ClientList clients={[ana]} onSetPassword={onSetPassword} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Cambiar contraseña de Ana García López" }),
    );

    expect(onSetPassword).toHaveBeenCalledWith(ana);
  });

  it("shows an empty state", () => {
    wrap(<ClientList clients={[]} onSetPassword={() => {}} />);

    expect(screen.getByText("Todavía no hay clientes.")).toBeInTheDocument();
  });
});
