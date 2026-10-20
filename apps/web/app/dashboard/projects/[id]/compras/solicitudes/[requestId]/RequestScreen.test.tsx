// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../../messages/es.json";
import { approvedRequest, requestDetail } from "../../../../../../../test/request-fixture";
import RequestScreen from "./RequestScreen";

vi.mock("../../../../../../actions/purchase-requests", () => ({
  decideRequestAction: vi.fn(),
  cancelRequestAction: vi.fn(),
}));
const actions = await import("../../../../../../actions/purchase-requests");

function renderScreen(props: Partial<Parameters<typeof RequestScreen>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <RequestScreen projectId="p-1" request={requestDetail} canManage canDecide={false} {...props} />
    </NextIntlClientProvider>,
  );
}

const decision = () => within(screen.getByRole("region", { name: "Aprobación" }));

beforeEach(() => {
  vi.mocked(actions.decideRequestAction).mockReset().mockResolvedValue({ success: true });
  vi.mocked(actions.cancelRequestAction).mockReset().mockResolvedValue({ success: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("RequestScreen", () => {
  it("shows the request: status, who asked, late warning, lines against the budget, data and history", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Placa de yeso para trasdosados" })).toBeInTheDocument();
    expect(screen.getByText("VTH-26-001 · SOL-003")).toBeInTheDocument();
    expect(screen.getByText("Solicitada por Laura Pérez el 10 oct")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 días tarde Hacía falta para el 15 oct y todavía no hay pedido.");

    const lines = within(screen.getByRole("region", { name: "Partidas" }));
    expect(lines.getAllByRole("row").map((row) => row.textContent)).toEqual([
      "PartidaCosteYa contratadoEstimado",
      "07.01 Trasdosado de placa de yeso 310,00 m²7440,00—6250,00",
      "07.04 Placa hidrófuga en baños 54,00 m²2660,001000,001000,00",
      "Total estimado7250,00",
    ]);
    expect(screen.getByRole("link", { name: "Yesos y Placas del Norte S.L." })).toHaveAttribute("href", "/dashboard/subcontratas/empresas/sup-yesos");

    const history = within(screen.getByRole("region", { name: "Historial" })).getAllByRole("listitem");
    expect(history[0]).toHaveTextContent("Importe de 07.01: 6000,00 → 6250,00 · Laura Pérez");
    expect(history[1]).toHaveTextContent("Para el: 20 oct → 15 oct");
    expect(history[2]).toHaveTextContent("Creado con 2 partidas, 7000,00 €");
    expect(decision().getByText("Espera la aprobación de un administrador.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/solicitudes/req-3/editar");
  });

  it("lets an admin approve, or reject only with a reason", async () => {
    renderScreen({ canDecide: true });
    await userEvent.click(decision().getByRole("button", { name: "Aprobar" }));
    expect(actions.decideRequestAction).toHaveBeenCalledWith("req-3", { decision: "approve", note: "" });

    await userEvent.click(decision().getByRole("button", { name: "Rechazar" }));
    const reject = decision().getByRole("button", { name: "Rechazar solicitud" });
    expect(reject).toBeDisabled();
    await userEvent.type(decision().getByLabelText("Motivo del rechazo"), "Hay stock en VTH-26-003");
    await userEvent.click(reject);
    expect(actions.decideRequestAction).toHaveBeenLastCalledWith("req-3", { decision: "reject", note: "Hay stock en VTH-26-003" });
  });

  it("shows a decision's error", async () => {
    vi.mocked(actions.decideRequestAction).mockResolvedValue({ error: "invalid_state" });
    renderScreen({ canDecide: true });
    await userEvent.click(decision().getByRole("button", { name: "Aprobar" }));
    expect(await decision().findByRole("alert")).toHaveTextContent("La solicitud ya no está en ese estado.");
  });

  it("once approved, turns into an order and can still be cancelled", async () => {
    renderScreen({ request: approvedRequest });
    expect(decision().getByText(/Aprobada por Ana Admin el 16 oct/)).toHaveTextContent("“Adelante”");
    expect(decision().getByText("Lista para pedir.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear pedido" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/nuevo?solicitud=req-3");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Aprobada “Adelante” · Ana Admin");
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    expect(actions.cancelRequestAction).toHaveBeenCalledWith("req-3");
  });

  it("links an ordered request to its order, and offers viewers nothing to change", () => {
    renderScreen({ request: { ...approvedRequest, status: "ordered", order: { id: "order-57", number: 57 }, lateDays: null }, canManage: false });
    expect(decision().getByRole("link", { name: "PED-057" })).toHaveAttribute("href", "/dashboard/projects/p-1/compras/order-57");
    expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Crear/ })).not.toBeInTheDocument();
  });
});

describe("RequestScreen once withdrawn", () => {
  it("shows a cancelled request as cancelled, not as approved", () => {
    renderScreen({
      request: {
        ...approvedRequest,
        status: "cancelled",
        lateDays: null,
        events: [{ id: "rev-9", action: "reopened", detail: { orderId: "order-57", number: 57 }, note: null, by: "Ana Admin", at: "2026-10-17T09:00:00.000Z" }, ...approvedRequest.events],
      },
    });
    expect(decision().queryByText(/Aprobada por/)).not.toBeInTheDocument();
    expect(decision().getByText("Cancelada: no se pedirá.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("PED-057 cancelado: aprobada de nuevo, se puede volver a pedir");
  });
});
