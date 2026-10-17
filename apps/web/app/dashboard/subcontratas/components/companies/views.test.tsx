// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AttentionItem,
  DocBadge,
  SubcontractorKind,
  SubcontractorListItem,
  SubcontractorsOverview,
} from "@repo/core/contract";
import messages from "../../../../../messages/es.json";
import AttentionList from "./AttentionList";
import CompaniesKpis from "./CompaniesKpis";
import CompaniesTable, { NO_FILTER, filterCompanies } from "./CompaniesTable";

// The views are pure: they take data and callbacks, so no mocks are needed.

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

const ok: DocBadge = { state: "validated", daysLeft: null };

function company(overrides: Partial<SubcontractorListItem> = {}): SubcontractorListItem {
  return {
    id: "c-1",
    kind: "company",
    legalName: "Cubiertas Besaya S.L.",
    taxIdMasked: "B39•••118",
    reaRegion: "cantabria",
    trades: ["roofing"],
    status: "apta",
    pillars: { rea: ok, aeat: ok, ss: ok, rc: { state: "expiring", daysLeft: 18 }, prl: ok },
    docsValid: 7,
    docsTotal: 7,
    workers: 4,
    projectIds: ["p-1"],
    suppliesOnly: false,
    ...overrides,
  };
}

const companies = [
  company(),
  company({
    id: "c-2",
    legalName: "Electricidad Saja S.L.",
    taxIdMasked: "B39•••450",
    trades: ["electrical"],
    status: "bloqueada",
    pillars: { rea: ok, aeat: { state: "expired", daysLeft: -8 }, ss: ok, rc: ok, prl: ok },
    docsValid: 6,
    projectIds: [],
  }),
  company({ id: "c-3", legalName: "Javier Ruiz Pellón", kind: "self_employed", taxIdMasked: "72•••836B", status: "pendiente", trades: ["carpentry"], projectIds: [] }),
];

const item = (overrides: Partial<AttentionItem>): AttentionItem => ({
  subcontractorId: "c-2",
  subcontractorName: "Electricidad Saja S.L.",
  workerId: null,
  workerName: null,
  projectId: null,
  projectRef: null,
  documentId: "d-1",
  requirementIds: ["cert_aeat_contratistas"],
  state: "expired",
  daysLeft: -8,
  date: "2026-10-09",
  affectedWorkers: 3,
  ...overrides,
});

describe("CompaniesKpis", () => {
  it("shows the four key figures", () => {
    const overview: Pick<SubcontractorsOverview, "counts" | "workers" | "expiring" | "expired" | "onSiteToday"> = {
      counts: { apta: 4, pendiente: 3, bloqueada: 1 },
      workers: { total: 31, ok: 16, pending: 11, blocked: 4 },
      expiring: 3,
      expired: 2,
      onSiteToday: { projectRefs: ["VTH-26-001"], companies: 3, workers: 9, blocked: ["Electricidad Saja S.L."] },
    };
    wrap(<CompaniesKpis overview={overview} />);

    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("4 aptas")).toBeInTheDocument();
    expect(screen.getByText("1 bloqueada")).toBeInTheDocument();
    expect(screen.getByText("/ 31")).toBeInTheDocument();
    expect(screen.getByText("11 pendientes · 4 bloqueados")).toBeInTheDocument();
    expect(screen.getByText("2 ya caducados")).toBeInTheDocument();
    expect(screen.getByText("En obra hoy · VTH-26-001")).toBeInTheDocument();
    expect(screen.getByText("Electricidad Saja S.L.: acceso bloqueado")).toBeInTheDocument();
  });
});

describe("AttentionList", () => {
  const items = [
    item({}),
    item({ documentId: "d-2", requirementIds: ["poliza_rc_subcontrata"], state: "uploaded", subcontractorId: "c-1", subcontractorName: "Cubiertas Besaya S.L.", date: "2026-10-14", affectedWorkers: 0 }),
    item({ documentId: "d-3", requirementIds: ["rnt_mensual"], state: "requested", subcontractorId: "c-3", subcontractorName: "Javier Ruiz Pellón", affectedWorkers: 0 }),
    item({ documentId: null, requirementIds: ["rea_subcontrata", "cert_tgss", "evaluacion_riesgos"], state: "missing", date: null, subcontractorId: "c-1", subcontractorName: "Cubiertas Besaya S.L.", affectedWorkers: 0 }),
  ];
  const kindOf = (id: string): SubcontractorKind => (id === "c-3" ? "self_employed" : "company");

  it("asks for, reminds of or links to each item", async () => {
    const onRequest = vi.fn();
    wrap(<AttentionList items={items} kindOf={kindOf} canManage busy={false} onRequest={onRequest} />);

    const list = screen.getByRole("region", { name: /Requiere atención/ });
    expect(list).toHaveAttribute("id", "caducidades");
    expect(screen.getByText("Caducó el 09/10/2026 · 3 trabajadores sin acceso")).toBeInTheDocument();
    // The self-employed see their RETA receipt instead of the RNT.
    expect(screen.getByText("Recibo RETA del último mes")).toBeInTheDocument();
    expect(screen.getByText("Faltan 3 documentos obligatorios")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Validar" })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/empresas/c-1?tab=documentos",
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Solicitar" })[0]!);
    expect(onRequest).toHaveBeenCalledWith(items[0]);
    await userEvent.click(screen.getByRole("button", { name: "Recordar" }));
    expect(onRequest).toHaveBeenLastCalledWith(items[2]);
  });

  it("offers no actions to viewers", () => {
    wrap(<AttentionList items={items} kindOf={kindOf} canManage={false} busy={false} onRequest={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says when there is nothing to do", () => {
    wrap(<AttentionList items={[]} kindOf={kindOf} canManage busy={false} onRequest={() => {}} />);
    expect(screen.getByText("Todo en orden: no hay nada pendiente.")).toBeInTheDocument();
  });
});

describe("CompaniesTable", () => {
  it("lists the companies with their document columns", () => {
    wrap(<CompaniesTable companies={companies} projects={[]} filter={NO_FILTER} onFilterChange={() => {}} />);

    const row = screen.getByRole("link", { name: "Electricidad Saja S.L." }).closest("tr")!;
    expect(within(row).getByText("Caducado")).toBeInTheDocument();
    expect(within(row).getByText("6/7")).toBeInTheDocument();
    expect(within(row).getByText("Bloqueada")).toBeInTheDocument();
    expect(screen.getAllByText("18 días")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Abrir la ficha de Javier Ruiz Pellón" })).toHaveAttribute(
      "href",
      "/dashboard/subcontratas/empresas/c-3",
    );
  });

  it("changes the filter from its chips", async () => {
    const onFilterChange = vi.fn();
    wrap(<CompaniesTable companies={companies} projects={[]} filter={NO_FILTER} onFilterChange={onFilterChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Bloqueadas/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ ...NO_FILTER, status: "bloqueada" });
  });

  it("shows only what the filter keeps", () => {
    wrap(
      <CompaniesTable companies={companies} projects={[]} filter={{ ...NO_FILTER, status: "pendiente" }} onFilterChange={() => {}} />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Pendientes/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters by name or masked CIF, trade and obra", () => {
    expect(filterCompanies(companies, { ...NO_FILTER, query: "saja" }).map((c) => c.id)).toEqual(["c-2"]);
    expect(filterCompanies(companies, { ...NO_FILTER, query: "836b" }).map((c) => c.id)).toEqual(["c-3"]);
    expect(filterCompanies(companies, { ...NO_FILTER, trade: "roofing" }).map((c) => c.id)).toEqual(["c-1"]);
    expect(filterCompanies(companies, { ...NO_FILTER, projectId: "p-1" }).map((c) => c.id)).toEqual(["c-1"]);
  });

  it("shows a material supplier without CAE status or document columns, and only under 'all'", () => {
    const supplier = company({ id: "c-9", legalName: "Piedra de Liébana S.L.", suppliesOnly: true, workers: 0 });
    wrap(<CompaniesTable companies={[...companies, supplier]} projects={[]} filter={NO_FILTER} onFilterChange={() => {}} />);

    const row = screen.getByRole("link", { name: "Piedra de Liébana S.L." }).closest("tr")!;
    expect(within(row).getAllByText("Proveedor de material")).toHaveLength(2);
    expect(within(row).getByText("Sin documentación CAE")).toBeInTheDocument();
    expect(within(row).queryByText("Apta")).not.toBeInTheDocument();
    expect(filterCompanies([supplier], { ...NO_FILTER, status: "apta" })).toEqual([]);
    expect(filterCompanies([supplier], NO_FILTER)).toEqual([supplier]);
  });

  it("says when nothing matches", () => {
    wrap(<CompaniesTable companies={companies} projects={[]} filter={{ ...NO_FILTER, query: "zzz" }} onFilterChange={() => {}} />);
    expect(screen.getByText("Ninguna empresa coincide con el filtro.")).toBeInTheDocument();
  });
});
