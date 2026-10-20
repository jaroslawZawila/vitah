import { purchaseInvoicesService } from "@repo/core";
import { fileResponse, readForm, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/purchases/invoices/:invoiceId/file ───────────────────────────────
// GET (?fileId: an older version) → the invoice's PDF
// POST multipart { file (PDF ≤ 4 MB), note? } → { invoiceId, version }: a new
//   version; none is ever deleted
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ invoiceId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  const fileId = new URL(request.url).searchParams.get("fileId") ?? undefined;
  return withContext(request, async (ctx) => fileResponse(await purchaseInvoicesService.openInvoiceFile(ctx, invoiceId, fileId)));
}

export async function POST(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(request, async (ctx) => purchaseInvoicesService.addInvoiceFile(ctx, invoiceId, await readForm(request)), 201);
}
