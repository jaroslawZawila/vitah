// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  ProjectOption,
  SubcontractorAssignment,
  SubcontractorDetail,
  SubcontractorDoc,
  WorkerListItem,
} from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import BlockingBanner from "./BlockingBanner";
import CompanyHeader from "./CompanyHeader";
import CompanyTabs from "./CompanyTabs";
import HistoryList from "./HistoryList";
import ObrasTab from "./ObrasTab";
import SummaryTab from "./SummaryTab";
import WorkersTab from "./WorkersTab";

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

const doc = (overrides: Partial<SubcontractorDoc>): SubcontractorDoc => ({
  id: "d-1",
  requirementId: "cert_aeat_contratistas",
  workerId: null,
  projectId: null,
  status: "validated",
  state: "expired",
  daysLeft: -8,
  issuedAt: "2025-10-09",
  expiresAt: "2026-10-09",
  notApplicableReason: null,
  requestedAt: null,
  current: null,
  versions: [],
  ...overrides,
});

const worker: WorkerListItem = {
  id: "w-1",
  subcontractorId: "c-1",
  subcontractorName: "Electricidad Saja S.L.",
  subcontractorKind: "company",
  firstName: "Iván",
  surnames: "Gómez Ruiz",
  idDocumentMasked: "72•••836B",
  trade: "electrical",
  category: "officer_1",
  roles: ["preventive_resource"],
  docs: { tpc: { state: "expiring", daysLeft: 12 } },
  access: {
    status: "blocked",
    checks: [{ rule: "company", ok: false, blocking: true, reasons: [{ code: "company_blocked" }] }],
  },
};

const company: SubcontractorDetail = {
  id: "c-1",
  kind: "company",
  legalName: "Electricidad Saja S.L.",
  taxId: "B39123450",
  address: "C/ Ramón y Cajal 14",
  postalCode: "39300",
  city: "Torrelavega",
  province: "Cantabria",
  reaRegion: "cantabria",
  reaNumber: "39-0004217",
  phone: "942 81 64 20",
  email: "administracion@electricidadsaja.es",
  legalRep: "Marta Saiz Pérez",
  siteContact: "Iván Gómez Ruiz",
  siteContactPhone: "612 48 90 37",
  trades: ["electrical", "telecom"],
  isInstaller: true,
  installerReg: "39-IBTE-0218",
  headcount: 12,
  permanentCount: 3,
  subcontractsFurther: false,
  chainLevel: 1,
  preventionMode: "external_service",
  preventionEntity: "Prevencontrol Norte S.L.",
  preventionValidUntil: "2027-03-31",
  machinery: ["mewp"],
  status: { status: "bloqueada", expired: ["cert_aeat_contratistas"], pending: [] },
  lowPermanentShare: true,
  documents: [doc({})],
  assignments: [],
  workers: [worker],
  history: [],
  canManage: true,
};

describe("CompanyHeader", () => {
  it("shows the company and its actions", () => {
    wrap(<CompanyHeader company={company} />);
    expect(screen.getByRole("heading", { name: "Electricidad Saja S.L." })).toBeInTheDocument();
    expect(screen.getByText("Bloqueada")).toBeInTheDocument();
    expect(screen.getByText("B39123450")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Editar datos/ })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/empresas/c-1/editar",
    );
    expect(screen.getByRole("link", { name: /Dossier CAE/ })).toHaveAttribute(
      "href",
      "/api/v1/subcontractors/dossier?subcontractorId=c-1",
    );
  });

  it("hides editing from viewers", () => {
    wrap(<CompanyHeader company={{ ...company, canManage: false }} />);
    expect(screen.queryByRole("link", { name: /Editar datos/ })).not.toBeInTheDocument();
  });
});

describe("BlockingBanner", () => {
  it("says since when, why and who, and asks for the document", async () => {
    const onRequest = vi.fn();
    wrap(
      <BlockingBanner
        expired={company.documents}
        kind="company"
        workerNames={["Iván Gómez Ruiz", "Laura Cobo Fernández"]}
        canManage
        busy={false}
        onRequest={onRequest}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Acceso a obra bloqueado desde el 10/10/2026");
    expect(screen.getByText(/Documentos caducados: Certificado AEAT de contratistas\./)).toBeInTheDocument();
    expect(screen.getByText(/Trabajadores afectados: Iván Gómez Ruiz, Laura Cobo Fernández\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Solicitar documento/ }));
    expect(onRequest).toHaveBeenCalled();
  });
});

describe("CompanyTabs", () => {
  it("marks the current tab and switches", async () => {
    const onChange = vi.fn();
    wrap(<CompanyTabs tab="documentos" counts={{ trabajadores: 3 }} onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "Documentos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Trabajadores/ })).toHaveTextContent("3");
    await userEvent.click(screen.getByRole("tab", { name: "Historial" }));
    expect(onChange).toHaveBeenCalledWith("historial");
  });
});

describe("SummaryTab", () => {
  it("warns about the permanent-contract share", () => {
    wrap(<SummaryTab company={company} />);
    expect(screen.getByText("25 % indefinidos")).toBeInTheDocument();
    expect(screen.getByText("Menos del 30 % indefinidos (Ley 32/2006)")).toBeInTheDocument();
    expect(screen.getByText("1 caducado")).toBeInTheDocument();
  });
});

describe("WorkersTab", () => {
  it("lists workers with why they can't enter", () => {
    wrap(<WorkersTab workers={[worker]} subcontractorId="c-1" kind="company" canManage />);
    expect(screen.getByRole("link", { name: "Iván Gómez Ruiz" })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/trabajadores/w-1",
    );
    expect(screen.getByText("12 días")).toBeInTheDocument();
    expect(screen.getByText("Empresa bloqueada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Registrar trabajador/ })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/trabajadores/nuevo?empresa=c-1",
    );
  });
});

describe("HistoryList", () => {
  it("puts each entry in words", () => {
    wrap(
      <HistoryList
        kind="company"
        entries={[
          { id: "1", at: "2026-10-16T09:40:00.000Z", action: "document_validated", userName: "Pablo Ortiz", workerName: null, detail: { requirementId: "cert_tgss", version: 14 } },
          { id: "2", at: "2026-10-10T00:00:00.000Z", action: "document_expired", userName: null, workerName: null, detail: { requirementId: "cert_aeat_contratistas", affectedWorkers: 3 } },
          { id: "3", at: "2026-09-02T10:14:00.000Z", action: "updated", userName: "Ana Requejo", workerName: null, detail: { fields: { phone: ["1", "2"], email: ["a", "b"] } } },
          { id: "4", at: "2026-09-01T07:03:00.000Z", action: "worker_updated", userName: "Ana Requejo", workerName: "Iván Gómez Ruiz", detail: { fields: { roles: [[], ["preventive_resource"]] } } },
        ]}
      />,
    );
    expect(screen.getByText("Validó «Certificado TGSS al corriente» v14")).toBeInTheDocument();
    expect(
      screen.getByText("«Certificado AEAT de contratistas» caducado → empresa bloqueada; 3 trabajadores sin acceso"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sistema")).toBeInTheDocument();
    expect(screen.getByText("Editó datos: teléfono, email")).toBeInTheDocument();
    expect(screen.getByText("Ana Requejo · Trabajador: Iván Gómez Ruiz")).toBeInTheDocument();
  });
});

describe("ObrasTab", () => {
  const projects: ProjectOption[] = [
    { id: "p-1", ref: "VTH-26-001", address: "Caviedes", obraStage: 6, chapters: [{ code: "13", name: "Electricidad e iluminación" }, { code: "14", name: "Telecomunicaciones y seguridad" }] },
    { id: "p-2", ref: "VTH-26-002", address: "Zarzalejo", obraStage: 3, chapters: [{ code: "13", name: "Electricidad" }] },
  ];
  const assignment: SubcontractorAssignment = {
    projectId: "p-1",
    projectRef: "VTH-26-001",
    projectAddress: "Caviedes",
    chapterCodes: ["13"],
    plannedStart: "2026-10-05",
    plannedEnd: "2026-12-20",
    bookOrder: 7,
    bookDate: "2026-09-20",
    cssInformed: true,
    pssAdhesion: doc({ requirementId: "adhesion_pss", projectId: "p-1", state: "validated", daysLeft: null, expiresAt: null }),
    workers: { ok: 0, pending: 0, blocked: 3 },
  };

  it("shows each obra the company is on", () => {
    wrap(
      <ObrasTab assignments={[assignment]} projects={projects} kind="company" canManage busy={false} onSave={async () => true} onRemove={() => {}} />,
    );
    expect(screen.getByText("Electricidad e iluminación")).toBeInTheDocument();
    expect(screen.getByText("Asiento nº 7 · 20/09/2026")).toBeInTheDocument();
    expect(screen.getByText("0 con acceso · 0 pendientes · 3 bloqueados")).toBeInTheDocument();
  });

  it("assigns the company to another obra", async () => {
    const onSave = vi.fn(async () => true);
    wrap(
      <ObrasTab assignments={[assignment]} projects={projects} kind="company" canManage busy={false} onSave={onSave} onRemove={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Asignar a una obra/ }));
    await userEvent.selectOptions(screen.getByLabelText("Obra"), "p-2");
    await userEvent.click(screen.getByRole("button", { name: /Electricidad/ }));
    await userEvent.type(screen.getByLabelText("Inicio previsto"), "2027-01-10");
    await userEvent.type(screen.getByLabelText("Nº de orden"), "8");
    await userEvent.click(screen.getByLabelText("Coordinador de SyS informado"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSave).toHaveBeenCalledWith("p-2", {
      chapterCodes: ["13"],
      plannedStart: "2027-01-10",
      plannedEnd: "",
      bookOrder: "8",
      bookDate: "",
      cssInformed: true,
    });
  });

  it("edits and removes an assignment", async () => {
    const onSave = vi.fn(async () => true);
    const onRemove = vi.fn();
    wrap(
      <ObrasTab assignments={[assignment]} projects={projects} kind="company" canManage busy={false} onSave={onSave} onRemove={onRemove} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Quitar de la obra" }));
    expect(onRemove).toHaveBeenCalledWith(assignment);

    await userEvent.click(screen.getByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: /Telecomunicaciones/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onSave).toHaveBeenCalledWith("p-1", expect.objectContaining({ chapterCodes: ["13", "14"], bookOrder: "7", cssInformed: true }));
  });
});
