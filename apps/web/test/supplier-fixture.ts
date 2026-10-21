import type { PurchaseSupplierItem, SupplierPurchasing, TenantSuppliers } from "@repo/core/contract";
import { TODAY, invoiceItem, payment } from "./invoice-fixture";
import { orderItem } from "./purchasing-fixture";

// Static Compras › Proveedores data (19 Oct 2026): Montajes Steel Norte is owed
// 13.500 € (none past due), Piedra de Liébana 4.200 € past due; Yesos y Placas
// has no orders yet.

export function supplierItem(overrides: Partial<PurchaseSupplierItem> = {}): PurchaseSupplierItem {
  return {
    id: "sup-msn",
    legalName: "Montajes Steel Norte S.L.",
    kind: "company",
    suppliesOnly: false,
    caeStatus: "pendiente",
    orders: 3,
    projects: 2,
    contractedCents: 8_700_000,
    invoicedCents: 6_000_000,
    paidCents: 4_200_000,
    outstandingCents: 1_350_000,
    overdueCents: 0,
    retainedCents: 300_000,
    lastOrderOn: "2026-09-12",
    ...overrides,
  };
}

export const tenantSuppliers: TenantSuppliers = {
  suppliers: [
    supplierItem(),
    supplierItem({
      id: "sup-liebana",
      legalName: "Piedra de Liébana S.L.",
      suppliesOnly: true,
      caeStatus: "apta",
      orders: 1,
      projects: 1,
      contractedCents: 312_000,
      invoicedCents: 312_000,
      paidCents: 0,
      outstandingCents: 420_000,
      overdueCents: 420_000,
      retainedCents: 0,
      lastOrderOn: "2026-10-03",
    }),
    supplierItem({
      id: "sup-yesos",
      legalName: "Yesos y Placas del Norte S.L.",
      suppliesOnly: true,
      caeStatus: "apta",
      orders: 0,
      projects: 0,
      contractedCents: 0,
      invoicedCents: 0,
      paidCents: 0,
      outstandingCents: 0,
      retainedCents: 0,
      lastOrderOn: null,
    }),
  ],
  summary: {
    active: 2,
    contractedCents: 9_012_000,
    outstandingCents: 1_770_000,
    overdueCents: 420_000,
    overdueSuppliers: 1,
    retainedCents: 300_000,
  },
};

export const supplierPurchasing: SupplierPurchasing = {
  supplier: supplierItem(),
  orders: [
    orderItem({
      id: "order-4",
      number: 4,
      kind: "subcontract",
      subcontractorId: "sup-msn",
      supplierName: "Montajes Steel Norte S.L.",
      suppliesOnly: false,
      description: "Estructura Steel Frame",
      status: "contracted",
      expectedOn: null,
      lateDays: null,
    }),
  ],
  invoices: [invoiceItem()],
  payments: [payment],
  today: TODAY,
};
