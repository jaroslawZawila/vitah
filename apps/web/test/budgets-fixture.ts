import type { BudgetOverview, BudgetOverviewItem, BudgetOverviewRevision } from "@repo/core/contract";

// Every obra's budget as Proyectos › Presupuestos gets it: one in each state.

const revision = (r: Partial<BudgetOverviewRevision> & Pick<BudgetOverviewRevision, "number" | "status">): BudgetOverviewRevision => ({
  id: `r-${r.number}-${r.status}`,
  totalCents: 486_320_00,
  costCents: 404_600_00,
  contractTotalCents: r.totalCents ?? 486_320_00,
  acceptedAt: null,
  issuedOn: null,
  chosenOptions: 0,
  perM2Cents: 2_294_00,
  perM2DeltaBp: 130,
  validUntil: null,
  acceptedOn: null,
  rejectedOn: null,
  openChecks: null,
  daysLeft: null,
  ...r,
});

const item = (i: Partial<BudgetOverviewItem> & Pick<BudgetOverviewItem, "projectId" | "ref">): BudgetOverviewItem => ({
  address: "Calle Mayor 1",
  clientName: null,
  revision: null,
  generation: null,
  updatedAt: "2026-10-30T09:00:00.000Z",
  ...i,
});

export const budgetItems: BudgetOverviewItem[] = [
  item({
    projectId: "p-3",
    ref: "VTH-26-003",
    clientName: "Javier Ortega",
    address: "C/ Mayor 22, Collado Villalba",
    revision: revision({ number: 0, status: "draft", openChecks: 4, perM2DeltaBp: 610 }),
  }),
  item({
    projectId: "p-2",
    ref: "VTH-26-002",
    clientName: "Marta Iglesias",
    address: "Av. de los Robles 8, Tres Cantos",
    revision: revision({ number: 1, status: "issued", issuedOn: "2026-10-07", validUntil: "2026-11-06", daysLeft: 5 }),
  }),
  item({ projectId: "p-4", ref: "VTH-26-004", address: "C/ de la Fuente 5, Comillas", generation: { status: "running", step: 3 } }),
  item({
    projectId: "p-1",
    ref: "VTH-26-001",
    clientName: "Lucía Ferrer",
    address: "Barrio Caviedes 14, Valdáliga",
    revision: revision({ number: 2, status: "accepted", acceptedOn: "2026-10-14", contractTotalCents: 503_110_00, chosenOptions: 2 }),
  }),
  item({ projectId: "p-5", ref: "VTH-26-005", address: "Paseo del Río 2, Ribamontán al Mar" }),
];

export const budgetsOverview: BudgetOverview = {
  items: budgetItems,
  summary: {
    drafts: 1,
    generating: 1,
    openChecks: 4,
    issued: 1,
    issuedCents: 486_320_00,
    expiring: 1,
    accepted: 1,
    contractCents: 503_110_00,
    averagePerM2Cents: 2_265_00,
    aboveAverage: 1,
  },
};
