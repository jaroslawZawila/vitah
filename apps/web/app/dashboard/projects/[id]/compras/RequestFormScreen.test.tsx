// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/es.json";
import { purchaseForm } from "../../../../../test/purchasing-fixture";
import { requestDetail } from "../../../../../test/request-fixture";
import RequestFormScreen from "./RequestFormScreen";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../../actions/purchase-requests", () => ({
  createRequestAction: vi.fn(),
  updateRequestAction: vi.fn(),
}));
const actions = await import("../../../../actions/purchase-requests");

function renderScreen(props: Partial<Parameters<typeof RequestFormScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <RequestFormScreen projectId="p-1" form={purchaseForm} {...props} />
    </NextIntlClientProvider>,
  );
}

const suppliers = () => within(screen.getByRole("group", { name: "Proveedores" }));
const total = () => within(screen.getByRole("region", { name: "Importe estimado" }));

beforeEach(() => {
  router.push.mockReset();
  vi.mocked(actions.createRequestAction).mockReset().mockResolvedValue({ success: true, requestId: "req-4", number: 4 });
  vi.mocked(actions.updateRequestAction).mockReset().mockResolvedValue({ success: true });
});

describe("RequestFormScreen", () => {
  it("asks for lines with an estimate only, an optional supplier and the day it is needed", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Nueva solicitud" })).toBeInTheDocument();
    // As the order form: the first chapter with something left to order.
    expect(screen.getByRole("combobox", { name: "Capítulo" })).toHaveValue("07");
    expect(screen.queryByRole("columnheader", { name: "Cierra" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /cierra la partida/ })).not.toBeInTheDocument();

    await userEvent.click(suppliers().getByRole("button", { name: /Yesos y Placas/ }));
    // Picked again: left to the office.
    await userEvent.click(suppliers().getByRole("button", { name: /Yesos y Placas/ }));
    expect(suppliers().getByRole("button", { name: /Yesos y Placas/ })).toHaveAttribute("aria-pressed", "false");

    await userEvent.type(screen.getByLabelText("Concepto"), "Placa de yeso");
    await userEvent.type(screen.getByLabelText("Para el"), "2026-10-30");
    await userEvent.type(screen.getByLabelText("Notas"), "Hidrófuga en baños");
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir 07.01" }));
    const amount = screen.getByRole("textbox", { name: "Importe de 07.01" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "6250,00");
    expect(total().getByText("6250,00 €")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Enviar para aprobar" }));
    expect(actions.createRequestAction).toHaveBeenCalledWith("p-1", {
      kind: "material",
      subcontractorId: null,
      description: "Placa de yeso",
      neededBy: "2026-10-30",
      notes: "Hidrófuga en baños",
      lines: [{ lineageId: "lin-0701", amountCents: 625_000 }],
    });
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras/solicitudes/req-4");
  });

  it("needs a concept and a line before sending, and shows the action's error", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Enviar para aprobar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe el concepto y marca al menos una partida");
    expect(actions.createRequestAction).not.toHaveBeenCalled();

    vi.mocked(actions.createRequestAction).mockResolvedValue({ error: "unknown_line" });
    await userEvent.type(screen.getByLabelText("Concepto"), "Placa");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Capítulo" }), "07");
    await userEvent.click(screen.getByRole("checkbox", { name: "Incluir 07.02" }));
    await userEvent.click(screen.getByRole("button", { name: "Enviar para aprobar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Una de las partidas ya no está en el presupuesto aceptado.");
  });

  it("edits a pending request with its values", async () => {
    renderScreen({ request: requestDetail });
    expect(screen.getByRole("heading", { level: 1, name: "Editar solicitud" })).toBeInTheDocument();
    expect(screen.getByLabelText("Concepto")).toHaveValue("Placa de yeso para trasdosados");
    expect(screen.getByRole("textbox", { name: "Importe de 07.04" })).toHaveValue("1000,00");
    expect(suppliers().getByRole("button", { name: /Yesos y Placas/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(actions.updateRequestAction).toHaveBeenCalledWith("req-3", expect.objectContaining({
      subcontractorId: "sup-yesos",
      neededBy: "2026-10-15",
      lines: [
        { lineageId: "lin-0701", amountCents: 625_000 },
        { lineageId: "lin-0704", amountCents: 100_000 },
      ],
    }));
    expect(router.push).toHaveBeenCalledWith("/dashboard/projects/p-1/compras/solicitudes/req-3");
  });
});

describe("RequestFormScreen on a request whose line left the budget", () => {
  it("leaves the line out, so it can still be saved", async () => {
    renderScreen({
      request: {
        ...requestDetail,
        lines: [...requestDetail.lines, { ...requestDetail.lines[0]!, id: "rl-x", lineageId: "lin-gone", code: null, description: null }],
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(vi.mocked(actions.updateRequestAction).mock.calls[0]![1].lines).toEqual([
      { lineageId: "lin-0701", amountCents: 625_000 },
      { lineageId: "lin-0704", amountCents: 100_000 },
    ]);
  });
});
