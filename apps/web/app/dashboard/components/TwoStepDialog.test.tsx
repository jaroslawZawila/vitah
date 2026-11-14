// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import messages from "../../../messages/es.json";
import type { MfaStatus } from "@repo/core/contract";
import TwoStepDialog, { type TwoStepActions } from "./TwoStepDialog";

// Pure: it takes what the server answered as its callbacks' answers.

const ENROLMENT = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  uri: "otpauth://totp/ViTAH:laura%40vitah.es?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ViTAH",
  qr: "data:image/svg+xml;base64,PHN2Zy8+",
};
const CODES = Array.from({ length: 10 }, (_, i) => `ABCDE-FGHJ${i}`);
const OFF: MfaStatus = { enabled: false, recoveryCodesLeft: 0 };
const ON: MfaStatus = { enabled: true, recoveryCodesLeft: 8 };

function open(status: MfaStatus, overrides: Partial<TwoStepActions> = {}) {
  const actions = {
    begin: vi.fn(async () => ({ enrolment: ENROLMENT })),
    confirm: vi.fn(async (form: FormData) => (void form, { recoveryCodes: CODES })),
    disable: vi.fn(async (form: FormData) => (void form, {})),
    regenerate: vi.fn(async (form: FormData) => (void form, { recoveryCodes: CODES })),
    ...overrides,
  } satisfies TwoStepActions;
  const onOpenChange = vi.fn();
  const view = render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <TwoStepDialog open onOpenChange={onOpenChange} status={status} actions={actions} />
    </NextIntlClientProvider>,
  );
  const dialog = within(screen.getByRole("dialog", { name: "Verificación en dos pasos" }));
  return { actions, onOpenChange, dialog, view };
}

/** The form an action (a mock) was first called with. */
const sent = (action: unknown) => Object.fromEntries((action as Mock<(form: FormData) => unknown>).mock.calls[0]![0]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TwoStepDialog: switching it on", () => {
  it("says it is off and what is needed, and starts nothing by itself", () => {
    const { dialog, actions } = open(OFF);

    expect(dialog.getByText("Desactivada")).toBeInTheDocument();
    expect(dialog.getByText(/Necesitas una aplicación de autenticación/)).toBeInTheDocument();
    expect(actions.begin).not.toHaveBeenCalled();
  });

  it("shows the QR code and the secret to type, then asks for one code", async () => {
    const { dialog, actions } = open(OFF);

    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));

    const qr = await dialog.findByRole("img", { name: "Código QR para la aplicación de autenticación" });
    expect(qr).toHaveAttribute("src", ENROLMENT.qr);
    expect(actions.begin).toHaveBeenCalledTimes(1);
    // The secret in groups of four, to type by hand.
    expect(dialog.getByLabelText("Clave de configuración")).toHaveTextContent("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
    const code = dialog.getByLabelText("Código de verificación");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toBeRequired();
  });

  it("confirms with the code typed and shows the ten recovery codes, once", async () => {
    const { dialog, actions, onOpenChange } = open(OFF);
    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));
    await userEvent.type(await dialog.findByLabelText("Código de verificación"), "123456");

    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));

    await waitFor(() => expect(actions.confirm).toHaveBeenCalledTimes(1));
    expect(sent(actions.confirm)).toEqual({ code: "123456" });
    expect(await dialog.findByRole("status")).toHaveTextContent("Verificación en dos pasos activada.");
    const list = within(dialog.getByRole("list", { name: "Códigos de recuperación" }));
    expect(list.getAllByRole("listitem").map((item) => item.textContent)).toEqual(CODES);
    expect(dialog.getByText(/no se volverán a mostrar/)).toBeInTheDocument();
    // The secret is no longer on the page.
    expect(dialog.queryByLabelText("Clave de configuración")).not.toBeInTheDocument();
    expect(dialog.queryByRole("img")).not.toBeInTheDocument();

    await userEvent.click(dialog.getByRole("button", { name: "Los he guardado" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("copies the recovery codes on request", async () => {
    const writeText = vi.fn(async (text: string) => void text);
    const { dialog } = open(OFF);
    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));
    await userEvent.type(await dialog.findByLabelText("Código de verificación"), "123456");
    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));
    await dialog.findByRole("status");
    // user-event installs its own clipboard: ours goes in after it.
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    await userEvent.click(dialog.getByRole("button", { name: "Copiar" }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CODES.join("\n"));
    expect(await dialog.findByRole("button", { name: "Copiados" })).toBeInTheDocument();
  });

  it("stays on the setup, secret and all, when the code is wrong", async () => {
    const { dialog } = open(OFF, { confirm: vi.fn(async () => ({ error: "wrong_code" })) });
    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));
    await userEvent.type(await dialog.findByLabelText("Código de verificación"), "000000");

    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("Código incorrecto. Inténtalo de nuevo.");
    expect(dialog.getByRole("img")).toBeInTheDocument();
    expect(dialog.queryByRole("list")).not.toBeInTheDocument();
  });

  it("says so when it could not be started", async () => {
    const { dialog } = open(OFF, { begin: vi.fn(async () => ({ error: "mfa_already_enabled" })) });

    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("La verificación en dos pasos ya está activada.");
    expect(dialog.queryByRole("img")).not.toBeInTheDocument();
  });

  it("forgets the secret when it is closed half-way", async () => {
    const { dialog, onOpenChange } = open(OFF);
    await userEvent.click(dialog.getByRole("button", { name: "Activar" }));
    await dialog.findByRole("img");

    await userEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.body).not.toHaveTextContent("GEZD");
    expect(dialog.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("TwoStepDialog: when it is on", () => {
  it("says so, and how many recovery codes are left", () => {
    const { dialog } = open(ON);

    expect(dialog.getByText("Activada")).toBeInTheDocument();
    expect(dialog.getByText("Te quedan 8 códigos de recuperación.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Activar" })).not.toBeInTheDocument();
  });

  it.each([
    [0, "No te queda ningún código de recuperación."],
    [1, "Te queda 1 código de recuperación."],
  ])("counts %i recovery codes left", (recoveryCodesLeft, text) => {
    const { dialog } = open({ enabled: true, recoveryCodesLeft });

    expect(dialog.getByText(text)).toBeInTheDocument();
  });

  it("turns it off with the password and a code", async () => {
    const { dialog, actions } = open(ON);
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar" }));
    expect(dialog.getByLabelText("Contraseña actual")).toHaveAttribute("type", "password");
    expect(dialog.getByLabelText("Código de verificación")).toHaveAccessibleDescription(
      "El código de 6 dígitos de tu aplicación, o un código de recuperación.",
    );

    await userEvent.type(dialog.getByLabelText("Contraseña actual"), "CasaNordica26");
    await userEvent.type(dialog.getByLabelText("Código de verificación"), "123456");
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar" }));

    await waitFor(() => expect(actions.disable).toHaveBeenCalledTimes(1));
    expect(sent(actions.disable)).toEqual({ password: "CasaNordica26", code: "123456" });
    expect(await dialog.findByRole("status")).toHaveTextContent("Verificación en dos pasos desactivada.");
    // The form, and what was typed in it, is gone.
    expect(dialog.queryByLabelText("Contraseña actual")).not.toBeInTheDocument();
  });

  it.each([
    ["wrong_password", "La contraseña actual no es correcta."],
    ["wrong_code", "Código incorrecto. Inténtalo de nuevo."],
    ["too_many_attempts", "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo."],
    ["something_else", "No se ha podido completar. Inténtalo de nuevo."],
  ])("stays on when turning it off answers %s", async (error, text) => {
    const { dialog } = open(ON, { disable: vi.fn(async () => ({ error })) });
    await userEvent.click(dialog.getByRole("button", { name: "Desactivar" }));
    await userEvent.type(dialog.getByLabelText("Contraseña actual"), "x");
    await userEvent.type(dialog.getByLabelText("Código de verificación"), "000000");

    await userEvent.click(dialog.getByRole("button", { name: "Desactivar" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(text);
    expect(dialog.queryByRole("status")).not.toBeInTheDocument();
  });

  it("makes new recovery codes for a code, and shows them once", async () => {
    const { dialog, actions } = open(ON);
    await userEvent.click(dialog.getByRole("button", { name: "Generar códigos nuevos" }));
    expect(dialog.getByText(/los anteriores dejan de servir/)).toBeInTheDocument();

    await userEvent.type(dialog.getByLabelText("Código de verificación"), "ABCDE-FGHJK");
    await userEvent.click(dialog.getByRole("button", { name: "Generar códigos" }));

    await waitFor(() => expect(actions.regenerate).toHaveBeenCalledTimes(1));
    expect(sent(actions.regenerate)).toEqual({ code: "ABCDE-FGHJK" });
    expect(await dialog.findByRole("status")).toHaveTextContent("Códigos nuevos generados. Los anteriores ya no sirven.");
    expect(within(dialog.getByRole("list")).getAllByRole("listitem")).toHaveLength(10);
  });

  it("goes back from either form without doing anything", async () => {
    const { dialog, actions } = open(ON);

    await userEvent.click(dialog.getByRole("button", { name: "Desactivar" }));
    await userEvent.click(dialog.getByRole("button", { name: "Volver" }));
    await userEvent.click(dialog.getByRole("button", { name: "Generar códigos nuevos" }));
    await userEvent.click(dialog.getByRole("button", { name: "Volver" }));

    expect(dialog.getByText("Activada")).toBeInTheDocument();
    expect(actions.disable).not.toHaveBeenCalled();
    expect(actions.regenerate).not.toHaveBeenCalled();
  });
});
