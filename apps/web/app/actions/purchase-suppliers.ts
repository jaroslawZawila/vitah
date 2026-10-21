"use server";

// Thin portal adapters over @repo/core's suppliers view
// (packages/core/src/purchase-suppliers.ts): Compras › Proveedores. Read-only.

import { purchaseSuppliersService as svc } from "@repo/core";
import { read } from "./run";

export async function getSuppliers() {
  return (await read((ctx) => svc.listSuppliers(ctx)))?.data ?? null;
}

export async function getSupplierPurchasing(subcontractorId: string) {
  return (await read((ctx) => svc.getSupplierPurchasing(ctx, subcontractorId)))?.data ?? null;
}
