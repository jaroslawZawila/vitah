import * as z from "zod/v4";
import {
  and,
  asc,
  db,
  eq,
  lt,
  ne,
  or,
  projects,
  purchaseDocumentChecks,
  purchaseInvoiceFiles,
  purchaseOrderAmendments,
  purchaseInvoices,
  purchaseOrderDocuments,
  purchaseOrderDocumentVersions,
  purchaseOrders,
  purchasePayments,
  sql,
  subcontractors,
} from "@repo/db";
import { aiLimitReached } from "./ai-limit";
import { ClaudeError, MODELS, structuredCall, type ContentBlock } from "./budget-ai/claude";
import { requireEditor, type Ctx } from "./context";
import type { DocumentFinding } from "./contract";
import { fail } from "./obra-data";
import { invoiceAmounts } from "./purchase-calc";
import type { CheckRow } from "./purchase-check-data";
import { readStoredBytes } from "./project-files";

// ─── The AI's review of purchase documents ───────────────────────────────────
// Every PDF of Compras (an order document's version, an invoice's PDF, a
// payment's proof) gets a check: the same file uploaded before (by its
// SHA-256), and Claude reading it against what its record says. Warnings
// only: it never blocks, moves, deletes or changes a file or a record, nor a
// status or an amount. The portal runs the queue after each upload
// (`runPendingChecks`, after the response); staff may ask again or mark a
// check's warnings as seen. Within the tenant's monthly AI limit, each call
// logged in `ai_usage`.
// ─────────────────────────────────────────────────────────────────────────────

/** What Claude answers: the possible errors it sees (none when all agrees). */
const ANSWER = z.object({
  findings: z.array(
    z.object({
      kind: z.enum(["wrong_document", "other_project", "supplier_mismatch", "amount_mismatch", "date_mismatch", "number_mismatch", "unreadable", "inconsistency"]),
      detail_es: z.string(),
      detail_en: z.string(),
    }),
  ),
});

const SYSTEM = `Revisas documentos de compras de una constructora (pedidos, contratos, modificados, facturas de proveedores, justificantes de pago).
Recibes un PDF y los datos de su registro en la aplicación. Tu único papel es AVISAR de posibles errores; nunca decides ni cambias nada.
Señala solo lo que el documento contradiga claramente:
- wrong_document: no es el tipo de documento que dice el registro (p. ej. un presupuesto subido como factura).
- other_project: la obra o la dirección del documento es otra.
- supplier_mismatch: el proveedor (nombre o CIF/NIF) es otro.
- amount_mismatch: los importes (base, IVA, total, importe pagado) no coinciden.
- date_mismatch: las fechas no coinciden.
- number_mismatch: el número de factura, pedido o referencia no coincide.
- unreadable: no se puede leer (en blanco, borroso, sin contenido).
- inconsistency: otra incoherencia evidente dentro del documento o con el registro.
Si un dato no aparece en el documento, no es un error. No inventes. Si todo cuadra, devuelve una lista vacía.
Cada detalle, breve (una frase), en español (detail_es) y en inglés (detail_en), citando lo que pone el documento y lo que dice el registro.`;

const euros = (cents: number) => `${(cents / 100).toFixed(2)} €`;

/** What the check's record says about its file, for Claude to compare with. */
async function factsOf(check: CheckRow): Promise<{ projectId: string; text: string }> {
  const [order] = await db
    .select({
      number: purchaseOrders.number,
      kind: purchaseOrders.kind,
      description: purchaseOrders.description,
      orderedOn: purchaseOrders.orderedOn,
      projectId: purchaseOrders.projectId,
      ref: projects.ref,
      address: projects.address,
      supplier: subcontractors.legalName,
      taxId: subcontractors.taxId,
      amountCents: sql<number>`(select coalesce(sum(amount_cents), 0) from purchase_order_lines where order_id = ${purchaseOrders.id})::int`,
    })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
    .where(eq(purchaseOrders.id, check.orderId));
  if (!order) fail("not_found");
  // The order's amount is its last modificado's: the original contract and each modificado's PDF state their own.
  const amendments = await db
    .select()
    .from(purchaseOrderAmendments)
    .where(eq(purchaseOrderAmendments.orderId, check.orderId))
    .orderBy(asc(purchaseOrderAmendments.number));
  const originalCents = amendments[0]?.amountBeforeCents ?? order.amountCents;
  const lines = [
    `Obra: ${order.ref}, ${order.address}`,
    `Proveedor: ${order.supplier} (CIF/NIF ${order.taxId})`,
    `Pedido PED-${String(order.number).padStart(3, "0")} (${order.kind === "material" ? "material" : "subcontrato"}): ${order.description}; importe actual ${euros(order.amountCents)} sin IVA${order.orderedOn ? `; fecha ${order.orderedOn}` : ""}`,
    ...(amendments.length > 0
      ? [
          `Importe original del contrato: ${euros(originalCents)} sin IVA. Modificados: ${amendments
            .map((a) => `nº ${a.number} del ${a.signedOn}, de ${euros(a.amountBeforeCents)} a ${euros(a.amountAfterCents)} («${a.concept}»)`)
            .join("; ")}`,
        ]
      : []),
  ];
  if (check.documentVersionId) {
    const [doc] = await db
      .select({
        id: purchaseOrderDocuments.id,
        title: purchaseOrderDocuments.title,
        version: purchaseOrderDocumentVersions.version,
        note: purchaseOrderDocumentVersions.note,
      })
      .from(purchaseOrderDocumentVersions)
      .innerJoin(purchaseOrderDocuments, eq(purchaseOrderDocuments.id, purchaseOrderDocumentVersions.documentId))
      .where(eq(purchaseOrderDocumentVersions.id, check.documentVersionId));
    lines.push(`Documento del pedido: «${doc?.title ?? check.label}», versión ${doc?.version ?? 1}${doc?.note ? ` (${doc.note})` : ""}`);
    const amendment = amendments.find((a) => doc && a.documentId === doc.id);
    if (amendment) {
      lines.push(`Este documento es el modificado nº ${amendment.number}: cambia el pedido de ${euros(amendment.amountBeforeCents)} a ${euros(amendment.amountAfterCents)}.`);
    }
  } else {
    const invoiceId = check.invoiceFileId
      ? (await db.select({ id: purchaseInvoiceFiles.invoiceId }).from(purchaseInvoiceFiles).where(eq(purchaseInvoiceFiles.id, check.invoiceFileId)))[0]?.id
      : (await db.select({ id: purchasePayments.invoiceId }).from(purchasePayments).where(eq(purchasePayments.id, check.paymentId!)))[0]?.id;
    const invoice = invoiceId ? await db.query.purchaseInvoices.findFirst({ where: eq(purchaseInvoices.id, invoiceId) }) : undefined;
    if (invoice) {
      const amounts = invoiceAmounts(invoice);
      lines.push(
        `${invoice.kind === "credit_note" ? "Abono" : "Factura"} ${invoice.number} del ${invoice.issuedOn}${invoice.dueOn ? `, vence el ${invoice.dueOn}` : ""}: base ${euros(amounts.baseCents)}, IVA ${invoice.vatKind} ${euros(amounts.vatCents)}, IRPF ${euros(amounts.irpfCents)}, total ${euros(amounts.totalCents)}`,
      );
    }
    if (check.paymentId) {
      const [payment] = await db.select().from(purchasePayments).where(eq(purchasePayments.id, check.paymentId));
      if (payment) {
        lines.push(`Justificante de un pago de ${euros(payment.amountCents)} el ${payment.paidOn} (${payment.method}${payment.reference ? `, referencia ${payment.reference}` : ""}) de esa factura`);
      }
    } else {
      lines.push("El PDF es la propia factura.");
    }
  }
  return { projectId: order.projectId, text: lines.join("\n") };
}

/** Other files of the tenant with the same content: the same PDF uploaded twice. */
async function duplicatesOf(check: CheckRow, sha256: string): Promise<DocumentFinding[]> {
  const rows = await db
    .select({
      label: purchaseDocumentChecks.label,
      orderId: purchaseDocumentChecks.orderId,
      projectId: purchaseOrders.projectId,
      invoiceId: sql<string | null>`coalesce(
        (select invoice_id from purchase_invoice_files where id = ${purchaseDocumentChecks.invoiceFileId}),
        (select invoice_id from purchase_payments where id = ${purchaseDocumentChecks.paymentId}))`,
    })
    .from(purchaseDocumentChecks)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseDocumentChecks.orderId))
    .where(
      and(
        eq(purchaseDocumentChecks.tenantId, check.tenantId),
        eq(purchaseDocumentChecks.sha256, sha256),
        ne(purchaseDocumentChecks.id, check.id),
      ),
    );
  return rows.map((r) => ({ kind: "duplicate", detail: null, duplicate: { label: r.label, orderId: r.orderId, projectId: r.projectId, invoiceId: r.invoiceId } }));
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Reviews one claimed (`running`) check and stores what it found; `withAi`
 * false (past the monthly limit) finds duplicates only and leaves it
 * `skipped`. Never throws: whatever fails leaves it `failed`, to ask again.
 */
async function review(ctx: Ctx, check: CheckRow, withAi: boolean) {
  const finish = (values: Partial<CheckRow>) =>
    db
      .update(purchaseDocumentChecks)
      .set({ checkedAt: new Date(), ...values })
      .where(eq(purchaseDocumentChecks.id, check.id));
  let duplicates: DocumentFinding[] = [];
  try {
    const bytes = await readStoredBytes(check.pathname);
    if (!bytes) return await finish({ status: "failed", reason: "missing_file" });
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    await db.update(purchaseDocumentChecks).set({ sha256 }).where(eq(purchaseDocumentChecks.id, check.id));
    duplicates = await duplicatesOf(check, sha256);
    if (!withAi) return await finish({ status: "skipped", reason: "ai_limit", findings: duplicates });
    const facts = await factsOf(check);
    const content: ContentBlock[] = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
      { type: "text", text: `Datos del registro:\n${facts.text}` },
    ];
    const answer = await structuredCall(
      { model: MODELS.checker, system: SYSTEM, content, schema: ANSWER, maxTokens: 4_000, fallback: false },
      { tenantId: ctx.tenantId, userId: ctx.userId, projectId: facts.projectId, generationId: null, purpose: "purchase.check" },
    );
    const findings: DocumentFinding[] = [
      ...duplicates,
      ...answer.findings.map((f) => ({ kind: f.kind, detail: { es: f.detail_es, en: f.detail_en } })),
    ];
    return await finish({ status: "done", findings, reason: null });
  } catch (error) {
    // A duplicate is still worth telling.
    const reason = error instanceof ClaudeError ? error.code : "error";
    if (!(error instanceof ClaudeError)) console.error("Purchase document check failed", error);
    return finish({ status: "failed", findings: duplicates, reason }).catch((cause: unknown) => console.error("Purchase document check not saved", cause));
  }
}

/**
 * Queues the files uploaded in the last day that have no check yet (an order
 * document's version, an invoice's PDF, a payment's proof). The portal calls
 * it as an upload answers (so the page shows the review coming), then
 * `runPendingChecks` after the response.
 */
export async function queueNewChecks(ctx: Ctx) {
  const tenantId = ctx.tenantId;
  await db.execute(sql`
    insert into purchase_document_checks (id, tenant_id, order_id, document_version_id, pathname, label)
    select gen_random_uuid()::text, v.tenant_id, d.order_id, v.id, v.pathname, d.title || ' · v' || v.version
    from purchase_order_document_versions v join purchase_order_documents d on d.id = v.document_id
    where v.tenant_id = ${tenantId} and v.created_at > now() - interval '1 day'
      and not exists (select 1 from purchase_document_checks c where c.document_version_id = v.id)
    on conflict do nothing`);
  await db.execute(sql`
    insert into purchase_document_checks (id, tenant_id, order_id, invoice_file_id, pathname, label)
    select gen_random_uuid()::text, f.tenant_id, i.order_id, f.id, f.pathname, i.number || ' · v' || f.version
    from purchase_invoice_files f join purchase_invoices i on i.id = f.invoice_id
    where f.tenant_id = ${tenantId} and f.created_at > now() - interval '1 day'
      and not exists (select 1 from purchase_document_checks c where c.invoice_file_id = f.id)
    on conflict do nothing`);
  await db.execute(sql`
    insert into purchase_document_checks (id, tenant_id, order_id, payment_id, pathname, label)
    select gen_random_uuid()::text, p.tenant_id, i.order_id, p.id, p.file_pathname, coalesce(p.file_name, i.number)
    from purchase_payments p join purchase_invoices i on i.id = p.invoice_id
    where p.tenant_id = ${tenantId} and p.file_pathname is not null and p.created_at > now() - interval '1 day'
      and not exists (select 1 from purchase_document_checks c where c.payment_id = p.id)
    on conflict do nothing`);
}

/** Takes the oldest pending check of the tenant, so two runs never review the same one. */
async function claim(tenantId: string): Promise<CheckRow | undefined> {
  const rows = await db.execute<{ id: string }>(sql`
    update purchase_document_checks set status = 'running', started_at = now()
    where id = (
      select id from purchase_document_checks
      where tenant_id = ${tenantId} and status = 'pending'
      order by created_at limit 1 for update skip locked)
    returning id`);
  const id = rows[0]?.id;
  if (!id) return undefined;
  return db.query.purchaseDocumentChecks.findFirst({ where: eq(purchaseDocumentChecks.id, id) });
}

/** How long one run goes on claiming (a function's life is longer): what is left waits for the next run. */
const RUN_BUDGET_MS = 200_000;

/** A check left running this long was cut off (a crash, a timeout): it is taken again. */
const STALE = sql`now() - interval '15 minutes'`;

/**
 * Reviews everything of the tenant waiting for it, one by one, for a few
 * minutes at most. The monthly AI limit is looked at before each: past it,
 * only duplicates are looked for (`skipped`); once there is room again the
 * skipped ones are queued again. Checks cut off mid-run are taken again.
 * Run by the portal after an upload's response. → how many ran.
 */
export async function runPendingChecks(ctx: Ctx) {
  const started = Date.now();
  const limited = await aiLimitReached(ctx.tenantId);
  await db
    .update(purchaseDocumentChecks)
    .set({ status: "pending" })
    .where(
      and(
        eq(purchaseDocumentChecks.tenantId, ctx.tenantId),
        or(
          and(eq(purchaseDocumentChecks.status, "running"), lt(purchaseDocumentChecks.startedAt, STALE)),
          limited ? undefined : and(eq(purchaseDocumentChecks.status, "skipped"), eq(purchaseDocumentChecks.reason, "ai_limit")),
        ),
      ),
    );
  let ran = 0;
  while (Date.now() - started < RUN_BUDGET_MS) {
    const check = await claim(ctx.tenantId);
    if (!check) break;
    await review(ctx, check, ran === 0 ? !limited : !(await aiLimitReached(ctx.tenantId)));
    ran++;
  }
  return ran;
}

async function requireCheck(ctx: Ctx, checkId: string) {
  const check = await db.query.purchaseDocumentChecks.findFirst({
    where: and(eq(purchaseDocumentChecks.id, checkId), eq(purchaseDocumentChecks.tenantId, ctx.tenantId)),
  });
  if (!check) fail("not_found");
  return check;
}

/**
 * Asks for a check's file to be reviewed again, after the response; one
 * still waiting just runs. Not while a review of it is under way (unless it
 * was cut off). → { checkId }
 */
export async function recheckDocument(ctx: Ctx, checkId: string) {
  requireEditor(ctx);
  const check = await requireCheck(ctx, checkId);
  const fresh = check.startedAt !== null && Date.now() - check.startedAt.getTime() < 15 * 60_000;
  if (check.status === "running" && fresh) fail("invalid_state");
  if (check.status === "pending") return { checkId };
  await db
    .update(purchaseDocumentChecks)
    .set({ status: "pending", findings: [], reason: null, sha256: null, checkedAt: null, dismissedAt: null, dismissedById: null })
    .where(eq(purchaseDocumentChecks.id, checkId));
  return { checkId };
}

/** Marks a check's warnings as seen: they stay, folded away. → { checkId } */
export async function dismissCheck(ctx: Ctx, checkId: string) {
  requireEditor(ctx);
  const check = await requireCheck(ctx, checkId);
  if (check.status !== "done" && check.status !== "failed") fail("invalid_state");
  await db
    .update(purchaseDocumentChecks)
    .set({ dismissedAt: new Date(), dismissedById: ctx.userId })
    .where(eq(purchaseDocumentChecks.id, checkId));
  return { checkId };
}
