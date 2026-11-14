// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../messages/es.json";
import Sidebar from "./Sidebar";
import type { TwoStepActions } from "./TwoStepDialog";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/projects", useParams: () => ({}) }));

const actions = {
  begin: vi.fn(async () => ({ enrolment: { secret: "GEZDGNBVGY3TQOJQ", uri: "otpauth://totp/x", qr: "data:image/svg+xml;base64,PHN2Zy8+" } })),
  confirm: vi.fn(async () => ({ recoveryCodes: ["ABCDE-FGHJK"] })),
  disable: vi.fn(async () => ({})),
  regenerate: vi.fn(async () => ({ recoveryCodes: ["ABCDE-FGHJK"] })),
} satisfies TwoStepActions;

function renderRail(twoStep?: Parameters<typeof Sidebar>[0]["twoStep"]) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <Sidebar
        name="Laura"
        email="laura@vitah.es"
        isAdmin={false}
        language="es"
        onLanguageChange={async () => ({})}
        onPasswordChange={async () => ({ success: true })}
        onSignOut={async () => {}}
        twoStep={twoStep}
      />
    </NextIntlClientProvider>,
  );
}

async function openSettings() {
  const [settings] = screen.getAllByRole("button", { name: /Ajustes/ });
  fireEvent.click(settings!);
  await screen.findByRole("menuitem", { name: "Cambiar contraseña" });
}

describe("the rail's settings: two-step verification", () => {
  it("opens its dialog from the settings menu, for any staff member", async () => {
    renderRail({ status: { enabled: false, recoveryCodesLeft: 0 }, actions });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openSettings();

    fireEvent.click(screen.getByRole("menuitem", { name: "Verificación en dos pasos" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Verificación en dos pasos" }));
    expect(dialog.getByText("Desactivada")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Activar" }));
    await waitFor(() => expect(actions.begin).toHaveBeenCalledTimes(1));
    expect(await dialog.findByRole("img")).toBeInTheDocument();
  });

  it("shows it on when the user has it on", async () => {
    renderRail({ status: { enabled: true, recoveryCodesLeft: 10 }, actions });
    await openSettings();

    fireEvent.click(screen.getByRole("menuitem", { name: "Verificación en dos pasos" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Verificación en dos pasos" }));
    expect(dialog.getByText("Activada")).toBeInTheDocument();
    expect(dialog.getByText("Te quedan 10 códigos de recuperación.")).toBeInTheDocument();
  });

  it.each([null, undefined])("is not offered when its state could not be read (%s)", async (twoStep) => {
    renderRail(twoStep);
    await openSettings();

    expect(screen.queryByRole("menuitem", { name: "Verificación en dos pasos" })).not.toBeInTheDocument();
  });
});
