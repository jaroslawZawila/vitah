// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/es.json";
import { editForm, orderDetail } from "../../../../../../../test/purchasing-fixture";
import AmendmentFormScreen from "./AmendmentFormScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../../../actions/purchasing", () => ({ amendPurchaseAction: vi.fn() }));
const actions = await import("../../../../../../actions/purchasing");

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <AmendmentFormScreen projectId="p-1" form={editForm} order={orderDetail} />
    </NextIntlClientProvider>,
  );
}

const total = () => within(screen.getByRole("region", { name: "Importe del pedido" }));

beforeEach(() => {
  router.push.mockReset();
  vi.mocked(actions.amendPurchaseAction).mockReset().mockResolvedValue({ success: true, number: 1 });
});

describe("AmendmentFormScreen", () => {
  it("starts from the order's lines, shows before → after, and records the modificado with its PDF", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Modificado nº 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2 · Partidas del pedido" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Motivo"), "Portes incluidos");
    const amount = screen.getByRole("textbox", { name: "Importe de 06.05" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "3300,00");
    expect(total().getByText("3120,00 €")).toBeInTheDocument();
    expect(total().getByText("3300,00 €")).toBeInTheDocument();
    expect(total().getByText("+180,00 €")).toHaveClass("text-bad");

    await userEvent.upload(screen.getByLabelText("Elegir PDF"), new File(["%PDF-1.7"], "mod.pdf", { type: "application/pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Registrar modificado nº 1" }));
    const [projectId, orderId, form] = vi.mocked(actions.amendPurchaseAction).mock.calls[0]!;
    expect([projectId, orderId]).toEqual(["p-1", "order-49"]);
    expect(JSON.parse(form.get("data") as string)).toEqual({
      concept: "Portes incluidos",
      signedOn: "2026-10-17",
      documentTitle: "Modificado nº {n}",
      lines: [{ lineageId: "lin-0605", amountCents: 330_000, closesLine: true }],
    });
    expect((form.get("file") as File).name).toBe("mod.pdf");
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras/order-49");
  });

  it("needs a reason, shows the action's error, and says when the PDF didn't go up", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Registrar modificado nº 1" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe el motivo y deja al menos una partida con su importe.");
    expect(actions.amendPurchaseAction).not.toHaveBeenCalled();

    vi.mocked(actions.amendPurchaseAction).mockResolvedValueOnce({ error: "no_changes" });
    await userEvent.type(screen.getByLabelText("Motivo"), "Nada");
    await userEvent.click(screen.getByRole("button", { name: "Registrar modificado nº 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El modificado no cambia ninguna partida");

    vi.mocked(actions.amendPurchaseAction).mockResolvedValueOnce({ success: true, number: 1, documentFailed: true });
    await userEvent.click(screen.getByRole("button", { name: "Registrar modificado nº 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("está registrado, pero su PDF no se ha podido subir");
    expect(router.push).not.toHaveBeenCalled();
  });
});
