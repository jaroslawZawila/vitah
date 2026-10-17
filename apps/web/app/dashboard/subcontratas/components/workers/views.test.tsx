// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { workerAccess, type DocFacts, type WorkerListItem } from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import AccessRulesCard from "./AccessRulesCard";
import CheckAccessPanel from "./CheckAccessPanel";
import WorkersKpis from "./WorkersKpis";
import WorkersTable, { type AccessFilter } from "./WorkersTable";

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

const valid: DocFacts = { status: "validated", expiresAt: null };
const today = "2026-10-17";

function worker(overrides: Partial<WorkerListItem>, docs: Record<string, DocFacts> = {}): WorkerListItem {
  const map = new Map(Object.entries(docs));
  return {
    id: "w-1",
    subcontractorId: "c-1",
    subcontractorName: "Cubiertas Besaya S.L.",
    subcontractorKind: "company",
    firstName: "Marcos",
    surnames: "Revuelta Gil",
    idDocumentMasked: "72•••018Z",
    trade: "roofing",
    category: "specialist_labourer",
    roles: [],
    docs: Object.fromEntries([...map].map(([id]) => [id, { state: "validated", daysLeft: null }])),
    access: workerAccess({ company: "apta", docs: map, roles: [], today }),
    ...overrides,
  };
}

const allDocs = { alta_ss: valid, tpc: valid, aptitud_medica: valid, entrega_epis: valid, info_riesgos: valid };
const marcos = worker({}, { alta_ss: valid, tpc: valid, aptitud_medica: valid, info_riesgos: valid });
const sergio = worker({ id: "w-2", firstName: "Sergio", surnames: "Fernández Cuesta", roles: ["preventive_resource"] }, allDocs);

describe("WorkersTable", () => {
  const counts: Record<AccessFilter, number> = { all: 2, ok: 0, pending: 2, blocked: 0 };
  const props = {
    total: 2,
    counts,
    filter: "all" as AccessFilter,
    onFilter: vi.fn(),
    query: "",
    onQuery: vi.fn(),
    companies: [{ id: "c-1", legalName: "Cubiertas Besaya S.L." }],
    companyId: "",
    onCompany: vi.fn(),
    projects: [],
    projectId: "",
    onProject: vi.fn(),
  };

  it("shows each worker's documents, access and its first reason", () => {
    wrap(<WorkersTable {...props} workers={[marcos]} />);
    const row = screen.getByRole("row", { name: /Marcos Revuelta Gil/ });

    expect(within(row).getByRole("link", { name: "Marcos Revuelta Gil" })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/trabajadores/w-1",
    );
    expect(within(row).getByText("72•••018Z")).toBeInTheDocument();
    expect(within(row).getByText("Peón especialista")).toBeInTheDocument();
    expect(within(row).getByText("Pendiente")).toBeInTheDocument();
    expect(within(row).getByText("Falta: Recibo de entrega de EPIs")).toBeInTheDocument();
  });

  it("asks the container to filter", async () => {
    wrap(<WorkersTable {...props} workers={[marcos, sergio]} />);
    await userEvent.click(screen.getByRole("button", { name: /Bloqueados/ }));
    await userEvent.type(screen.getByLabelText("Buscar nombre o empresa"), "s");
    await userEvent.selectOptions(screen.getByLabelText("Empresa"), "c-1");

    expect(props.onFilter).toHaveBeenCalledWith("blocked");
    expect(props.onQuery).toHaveBeenCalledWith("s");
    expect(props.onCompany).toHaveBeenCalledWith("c-1");
    expect(screen.getByText("Mostrando 2 de 2")).toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    wrap(<WorkersTable {...props} workers={[]} />);
    expect(screen.getByText("No hay trabajadores con estos filtros.")).toBeInTheDocument();
  });
});

describe("WorkersKpis", () => {
  it("counts by access and the preventive resources", () => {
    wrap(<WorkersKpis workers={[marcos, sergio]} />);
    const tile = (name: string) => screen.getByText(name).parentElement!;

    expect(tile("Registrados")).toHaveTextContent("2");
    expect(tile("Registrados")).toHaveTextContent("en 1 empresa");
    expect(tile("Pendientes")).toHaveTextContent("1");
    expect(tile("Con acceso")).toHaveTextContent("1");
    expect(tile("Recursos preventivos")).toHaveTextContent("1");
  });
});

describe("AccessRulesCard", () => {
  it("lists the six rules", () => {
    wrap(<AccessRulesCard />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("TPC o formación PRL del oficio")).toBeInTheDocument();
  });
});

describe("CheckAccessPanel", () => {
  const projects = [{ id: "p-1", ref: "VTH-26-001", address: "Caviedes", obraStage: 6, chapters: [] }];

  it("sends the number and the obra", async () => {
    const onCheck = vi.fn();
    wrap(<CheckAccessPanel projects={projects} projectId="p-1" pending={false} result={null} onCheck={onCheck} />);

    await userEvent.type(screen.getByLabelText("DNI, NIE o nº de TPC"), "72145836B");
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));

    expect(onCheck).toHaveBeenCalledWith({ query: "72145836B", projectId: "p-1" });
  });

  it("shows who it is, their access and why", () => {
    wrap(
      <CheckAccessPanel
        projects={projects}
        projectId=""
        pending={false}
        result={{ worker: { id: "w-1", name: "Marcos Revuelta Gil", subcontractorName: "Cubiertas Besaya S.L." }, access: marcos.access }}
        onCheck={vi.fn()}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Pendiente");
    expect(status).toHaveTextContent("Marcos Revuelta Gil · Cubiertas Besaya S.L.");
    expect(status).toHaveTextContent("Falta: Recibo de entrega de EPIs");
  });

  it("says when nobody has that number", () => {
    wrap(<CheckAccessPanel projects={[]} projectId="" pending={false} result={{ worker: null, access: null }} onCheck={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("No hay ningún trabajador registrado");
  });
});
