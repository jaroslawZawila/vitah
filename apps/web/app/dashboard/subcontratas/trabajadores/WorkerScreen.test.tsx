// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirementsFor, workerAccess, type SubcontractorDoc, type WorkerDetail } from "@repo/core/contract";
import messages from "../../../../messages/es.json";
import WorkerScreen from "./WorkerScreen";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../../../actions/subcontractors", () => ({
  createWorkerAction: vi.fn(),
  updateWorkerAction: vi.fn(),
  uploadSubcontractorDocumentAction: vi.fn(),
  validateSubcontractorDocumentAction: vi.fn(),
  rejectSubcontractorDocumentAction: vi.fn(),
  markNotApplicableAction: vi.fn(),
  requestSubcontractorDocumentsAction: vi.fn(),
}));
const actions = await import("../../../actions/subcontractors");

const VALID = ["alta_ss", "tpc", "aptitud_medica", "entrega_epis", "info_riesgos", "formacion_altura"];

const doc = (requirementId: string): SubcontractorDoc => {
  const ok = VALID.includes(requirementId);
  return {
    id: ok ? `d-${requirementId}` : null,
    requirementId: requirementId as SubcontractorDoc["requirementId"],
    workerId: "w-1",
    projectId: null,
    status: ok ? "validated" : null,
    state: ok ? "validated" : "missing",
    daysLeft: null,
    issuedAt: null,
    expiresAt: null,
    notApplicableReason: null,
    requestedAt: null,
    current: null,
    versions: [],
  };
};

// What the server works out for the fixture: the same rules over the same documents.
const facts = new Map(VALID.map((id) => [id, { status: "validated" as const, expiresAt: null }]));
const obra = { pssAdhesion: { status: "validated" as const, expiresAt: null }, bookEntry: false, chapterCodes: ["05"] };

const worker: WorkerDetail = {
  id: "w-1",
  subcontractorId: "c-1",
  firstName: "Pedro",
  surnames: "Llata Ceballos",
  idDocument: "72145836B",
  phone: null,
  category: "officer_1",
  trade: "roofing",
  ssNumber: null,
  contractType: null,
  startDate: null,
  tpcNumber: null,
  roles: [],
  ppeItems: [],
  subcontractorName: "Cubiertas Besaya S.L.",
  subcontractorKind: "company",
  companyStatus: "apta",
  documents: requirementsFor("worker").map((r) => doc(r.id)),
  access: workerAccess({ company: "apta", docs: facts, roles: [], today: "2026-10-17" }),
  obras: [
    {
      projectId: "p-1",
      projectRef: "VTH-26-001",
      chapterCodes: ["05"],
      pssAdhesion: { status: "validated", expiresAt: null },
      bookEntry: false,
      access: workerAccess({ company: "apta", docs: facts, roles: [], obra, today: "2026-10-17" }),
    },
  ],
  canManage: true,
};

const companies = [{ id: "c-1", legalName: "Cubiertas Besaya S.L.", kind: "company" as const, status: "apta" as const }];

const renderScreen = (props: Partial<Parameters<typeof WorkerScreen>[0]> = {}) =>
  render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      <WorkerScreen worker={worker} companies={companies} canManage {...props} />
    </NextIntlClientProvider>,
  );

const card = () => screen.getByText("Acceso a obra", { selector: "#worker-access-title" }).parentElement!;

beforeEach(() => {
  vi.mocked(actions.updateWorkerAction).mockReset().mockResolvedValue({ success: true, id: "w-1" });
  vi.mocked(actions.createWorkerAction).mockReset().mockResolvedValue({ success: true, id: "w-9" });
  router.push.mockReset();
});

describe("WorkerScreen", () => {
  it("works the access out live as roles are ticked", async () => {
    renderScreen();
    expect(card()).toHaveTextContent("Con acceso");

    await userEvent.click(screen.getByLabelText(/Recurso preventivo/));

    expect(card()).toHaveTextContent("Pendiente");
    expect(card()).toHaveTextContent("Falta: Nivel básico de prevención (60 h)");
    expect(screen.getByText(/Hay cambios sin guardar/)).toBeInTheDocument();
  });

  it("checks the obra's own rules when one is picked", async () => {
    renderScreen();
    await userEvent.selectOptions(screen.getByLabelText("Comprobar en"), "p-1");
    expect(card()).toHaveTextContent("Sin asiento en el Libro de Subcontratación");
  });

  it("saves the changes", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Casco" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(screen.getByText("Cambios guardados.")).toBeInTheDocument());
    expect(actions.updateWorkerAction).toHaveBeenCalledWith("w-1", expect.objectContaining({ ppeItems: ["helmet"] }));
  });

  it("lists the documents by group", () => {
    renderScreen();
    expect(screen.getByText("Formación PRL")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Subir PDF/ }).length).toBeGreaterThan(0);
  });

  it("registers a new worker and opens their page for the documents", async () => {
    renderScreen({ worker: null, initialCompanyId: "c-1" });
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Apellidos"), "Gutiérrez Mazo");
    await userEvent.type(screen.getByLabelText("DNI / NIE"), "X1234567L");
    await userEvent.click(screen.getByRole("button", { name: "Registrar trabajador" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/dashboard/subcontratas/trabajadores/w-9"));
    expect(actions.createWorkerAction).toHaveBeenCalledWith(expect.objectContaining({ subcontractorId: "c-1", idDocument: "X1234567L" }));
  });

  it("shows server errors", async () => {
    vi.mocked(actions.updateWorkerAction).mockResolvedValue({ error: "id_document_exists" });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay un trabajador con ese DNI/NIE.");
  });
});
