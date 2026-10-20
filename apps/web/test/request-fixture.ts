import type { PurchaseRequestDetail, PurchaseRequestListItem, TenantRequests } from "@repo/core/contract";

// Static purchase requests for the Compras tests (VTH-26-001 on 17 Oct 2026):
// SOL-003 (plaster boards, chapter 07) waits for approval and is 2 days past
// its needed-by day; SOL-002 is approved; SOL-001 became PED-049.

export function requestItem(overrides: Partial<PurchaseRequestListItem> = {}): PurchaseRequestListItem {
  return {
    id: "req-3",
    projectId: "p-1",
    projectRef: "VTH-26-001",
    number: 3,
    kind: "material",
    description: "Placa de yeso para trasdosados",
    neededBy: "2026-10-15",
    subcontractorId: "sup-yesos",
    supplierName: "Yesos y Placas del Norte S.L.",
    status: "pending",
    amountCents: 725_000,
    chapterCodes: ["07"],
    createdBy: "Laura Pérez",
    createdAt: "2026-10-10T09:00:00.000Z",
    decidedAt: null,
    order: null,
    lateDays: 2,
    ...overrides,
  };
}

export const requests: PurchaseRequestListItem[] = [
  requestItem(),
  requestItem({
    id: "req-2",
    number: 2,
    kind: "subcontract",
    description: "Revoco exterior",
    neededBy: "2026-11-02",
    subcontractorId: null,
    supplierName: null,
    status: "approved",
    amountCents: 730_000,
    decidedAt: "2026-10-12T09:00:00.000Z",
    lateDays: null,
  }),
  requestItem({
    id: "req-1",
    number: 1,
    description: "Piedra natural",
    status: "ordered",
    amountCents: 312_000,
    chapterCodes: ["06"],
    order: { id: "order-49", number: 49 },
    lateDays: null,
  }),
];

export const tenantRequests: TenantRequests = {
  requests: [
    ...requests,
    requestItem({ id: "req-9", projectId: "p-3", projectRef: "VTH-26-003", number: 1, description: "Ventanas", status: "rejected", lateDays: null }),
  ],
  projects: [
    { id: "p-1", ref: "VTH-26-001", address: "Caviedes" },
    { id: "p-3", ref: "VTH-26-003", address: "Suances" },
  ],
  summary: { pending: 1, pendingCents: 725_000, approved: 1, approvedCents: 730_000 },
};

export const requestDetail: PurchaseRequestDetail = {
  ...requestItem(),
  notes: "Hidrófuga en baños",
  decidedBy: null,
  decisionNote: null,
  lines: [
    {
      id: "rl-1",
      lineageId: "lin-0701",
      chapterCode: "07",
      code: "07.01",
      description: "Trasdosado de placa de yeso",
      unit: "m²",
      quantity: 310,
      costCents: 744_000,
      contractedCents: 0,
      amountCents: 625_000,
    },
    {
      id: "rl-2",
      lineageId: "lin-0704",
      chapterCode: "07",
      code: "07.04",
      description: "Placa hidrófuga en baños",
      unit: "m²",
      quantity: 54,
      costCents: 266_000,
      contractedCents: 100_000,
      amountCents: 100_000,
    },
  ],
  events: [
    {
      id: "rev-3",
      action: "lines",
      detail: { changes: [{ code: "07.01", lineageId: "lin-0701", from: { amountCents: 600_000, closesLine: true }, to: { amountCents: 625_000, closesLine: true } }] },
      note: null,
      by: "Laura Pérez",
      at: "2026-10-11T09:00:00.000Z",
    },
    {
      id: "rev-2",
      action: "updated",
      detail: { fields: { neededBy: { from: "2026-10-20", to: "2026-10-15" } } },
      note: null,
      by: "Laura Pérez",
      at: "2026-10-11T09:00:00.000Z",
    },
    {
      id: "rev-1",
      action: "created",
      detail: { number: 3, amountCents: 700_000, lines: 2 },
      note: null,
      by: "Laura Pérez",
      at: "2026-10-10T09:00:00.000Z",
    },
  ],
};

/** SOL-003 once an admin approved it. */
export const approvedRequest: PurchaseRequestDetail = {
  ...requestDetail,
  status: "approved",
  decidedAt: "2026-10-16T09:00:00.000Z",
  decidedBy: "Ana Admin",
  decisionNote: "Adelante",
  events: [
    { id: "rev-4", action: "approved", detail: {}, note: "Adelante", by: "Ana Admin", at: "2026-10-16T09:00:00.000Z" },
    ...requestDetail.events,
  ],
};
