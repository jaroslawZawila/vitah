import { purchaseInvoicesService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/purchases/invoices/:invoiceId ────────────────────────────────────
// GET → PurchaseInvoiceDetail
// PATCH any of { number, issuedOn, dueOn, notes } and, until something is
//   paid, { baseCents, vatKind, irpfBp, retentionBp, milestoneId, lines }
//   → { invoiceId }
// DELETE (nothing paid, no credit note on it) → { invoiceId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ invoiceId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(request, (ctx) => purchaseInvoicesService.getInvoice(ctx, invoiceId));
}

export async function PATCH(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(request, async (ctx) => purchaseInvoicesService.updateInvoice(ctx, invoiceId, await readJson(request)));
}

export async function DELETE(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(request, (ctx) => purchaseInvoicesService.deleteInvoice(ctx, invoiceId));
}
