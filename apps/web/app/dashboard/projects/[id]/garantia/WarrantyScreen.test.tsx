// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { ProjectWarranty, WarrantyClaimSummary } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import WarrantyScreen from "./WarrantyScreen";

const claim = (overrides: Partial<WarrantyClaimSummary>): WarrantyClaimSummary => ({
  id: "c-1",
  number: 1,
  kind: "plumbing",
  room: "bathroom",
  description: "Gotea el grifo del lavabo.",
  urgent: false,
  status: "received",
  visitOn: null,
  answer: null,
  answeredAt: null,
  photoCount: 0,
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  ...overrides,
});

const warranty: ProjectWarranty = {
  handedOver: true,
  handoverOn: "2026-04-02",
  handoverSource: "acta",
  coverage: [
    { scope: "finishes", years: 1, endsOn: "2027-04-02", active: true },
    { scope: "habitability", years: 3, endsOn: "2029-04-02", active: true },
    { scope: "structure", years: 10, endsOn: "2036-04-02", active: true },
  ],
  claims: [
    claim({ id: "c-2", number: 2, kind: "damp", room: "bedroom", urgent: true, status: "scheduled", visitOn: "2026-11-20", photoCount: 2 }),
    claim({ id: "c-1", number: 1, status: "resolved" }),
  ],
};

function renderScreen(value: ProjectWarranty = warranty) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="Europe/Madrid">
      <WarrantyScreen projectId="p-1" projectRef="VTH-26-001" warranty={value} />
    </NextIntlClientProvider>,
  );
}

describe("WarrantyScreen", () => {
  it("shows the hand-over, the three periods and the open claims, each opening its page", async () => {
    renderScreen();

    expect(screen.getByRole("heading", { level: 1, name: "Garantía" })).toBeInTheDocument();
    expect(screen.getByText("Entregada el 2 abr 2026 (acta de H9)")).toBeInTheDocument();
    expect(screen.getByText("10 años")).toBeInTheDocument();
    expect(screen.getByText("Hasta el 2 abr 2036")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /GAR-002/ });
    expect(link).toHaveAttribute("href", "/dashboard/projects/p-1/garantia/c-2");
    expect(link).toHaveTextContent("Humedades · Dormitorio");
    expect(link).toHaveTextContent("Urgente");
    expect(link).toHaveTextContent("Visita el 20 nov 2026 · 2 fotos");
    expect(screen.queryByRole("link", { name: /GAR-001/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Todas (2)" }));
    expect(screen.getByRole("link", { name: /GAR-001/ })).toHaveTextContent("Resuelta");
  });

  it("says the guarantee starts at hand-over, and when there is nothing yet", () => {
    renderScreen({ ...warranty, handedOver: false, handoverOn: null, handoverSource: null, claims: [] });

    expect(screen.getByText(/La garantía empieza con la entrega de la vivienda/)).toBeInTheDocument();
    expect(screen.getByText("Sin solicitudes de garantía")).toBeInTheDocument();
  });
});
