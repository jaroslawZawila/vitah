// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/es.json";
import { LoginForm } from "./LoginForm";

vi.mock("../actions/auth", () => ({ loginAction: vi.fn() }));
const { loginAction } = await import("../actions/auth");

const EMAIL = "laura@vitah.es";
const PASSWORD = "CasaNordica26";

function renderForm() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <LoginForm />
    </NextIntlClientProvider>,
  );
}

/** What the form sent on its nth submission. */
const sent = (call: number) => Object.fromEntries(vi.mocked(loginAction).mock.calls[call]![1]);

async function enterPassword(password = PASSWORD) {
  await userEvent.type(screen.getByLabelText("Correo electrónico"), EMAIL);
  await userEvent.type(screen.getByLabelText("Contraseña"), password);
  await userEvent.click(screen.getByRole("button", { name: "Acceder" }));
}

/** Signs in to an account with two-step verification: the form is on its code step. */
async function reachCodeStep() {
  vi.mocked(loginAction).mockResolvedValueOnce({ error: "mfa_required" });
  renderForm();
  await enterPassword();
  return screen.findByLabelText("Código de verificación");
}

beforeEach(() => {
  // Signed in: the real action redirects. Here it just answers nothing.
  vi.mocked(loginAction).mockReset().mockResolvedValue(null);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("LoginForm: the password step", () => {
  it("sends the email and the password, and no code", async () => {
    renderForm();

    await enterPassword();

    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(1));
    expect(sent(0)).toEqual({ email: EMAIL, password: PASSWORD });
    expect(screen.queryByLabelText("Código de verificación")).not.toBeInTheDocument();
  });

  it.each([
    ["invalid_credentials", "Credenciales incorrectas. Inténtalo de nuevo."],
    ["too_many_attempts", "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo."],
  ] as const)("shows %s and stays on the password", async (error, text) => {
    vi.mocked(loginAction).mockResolvedValue({ error });
    renderForm();

    await enterPassword("not-this-one");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código de verificación")).not.toBeInTheDocument();
  });
});

describe("LoginForm: the code step", () => {
  it("asks for the code once the server says one is required, showing no error", async () => {
    const code = await reachCodeStep();

    expect(screen.getByRole("heading", { name: "Verificación en dos pasos" })).toBeInTheDocument();
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAccessibleDescription("El código de 6 dígitos de tu aplicación de autenticación.");
    expect(code).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The first step's fields are gone from the page.
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).not.toBeInTheDocument();
  });

  it("sends the email, the password and the code together", async () => {
    await userEvent.type(await reachCodeStep(), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));

    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(2));
    expect(sent(1)).toEqual({ email: EMAIL, password: PASSWORD, code: "123456" });
  });

  it("keeps the password in memory only: not in the page, the URL or storage", async () => {
    const before = window.location.href;
    await reachCodeStep();

    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(document.body.innerHTML).not.toContain(EMAIL);
    expect(document.querySelectorAll("input")).toHaveLength(1);
    expect(window.location.href).toBe(before);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.localStorage).toHaveLength(0);
    expect(document.cookie).toBe("");
  });

  it("says a wrong code is wrong, generically, and lets it be tried again", async () => {
    const code = await reachCodeStep();
    vi.mocked(loginAction).mockResolvedValueOnce({ error: "invalid_code" });

    await userEvent.type(code, "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Código incorrecto. Inténtalo de nuevo.");
    await userEvent.type(screen.getByLabelText("Código de verificación"), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(3));
    expect(sent(2)).toEqual({ email: EMAIL, password: PASSWORD, code: "654321" });
  });

  it("stays on the code when there were too many attempts", async () => {
    const code = await reachCodeStep();
    vi.mocked(loginAction).mockResolvedValueOnce({ error: "too_many_attempts" });

    await userEvent.type(code, "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos fallidos.");
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("goes back to the password if it is no longer right, forgetting what it held", async () => {
    const code = await reachCodeStep();
    vi.mocked(loginAction).mockResolvedValueOnce({ error: "invalid_credentials" });

    await userEvent.type(code, "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Credenciales incorrectas.");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("");
  });

  it("takes a recovery code instead, in a field of its own", async () => {
    const code = await reachCodeStep();
    await userEvent.type(code, "12");

    await userEvent.click(screen.getByRole("button", { name: "Usar un código de recuperación" }));

    const recovery = screen.getByLabelText("Código de recuperación");
    expect(recovery).toHaveValue("");
    expect(recovery).toHaveAttribute("inputmode", "text");
    expect(recovery).toHaveAccessibleDescription(
      "Uno de los códigos que guardaste al activarla. Cada uno sirve una sola vez.",
    );
    await userEvent.type(recovery, "ABCDE-FGHJK");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(2));
    expect(sent(1)).toEqual({ email: EMAIL, password: PASSWORD, code: "ABCDE-FGHJK" });

    await userEvent.click(await screen.findByRole("button", { name: "Usar la aplicación de autenticación" }));
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("goes back to an empty first step on Volver, without asking the server", async () => {
    await reachCodeStep();

    await userEvent.click(screen.getByRole("button", { name: "Volver" }));

    expect(await screen.findByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("");
    expect(loginAction).toHaveBeenCalledTimes(1);
    // What was held is gone: signing in again starts from what is typed now.
    vi.mocked(loginAction).mockResolvedValueOnce({ error: "mfa_required" });
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "otra@vitah.es");
    await userEvent.type(screen.getByLabelText("Contraseña"), "OtraCasa2026");
    await userEvent.click(screen.getByRole("button", { name: "Acceder" }));
    await userEvent.type(await screen.findByLabelText("Código de verificación"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Verificar" }));
    await waitFor(() => expect(loginAction).toHaveBeenCalledTimes(3));
    expect(sent(2)).toEqual({ email: "otra@vitah.es", password: "OtraCasa2026", code: "111111" });
  });
});
