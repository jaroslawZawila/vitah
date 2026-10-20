// Where the Compras pages live (project tab, an order, its form, its PDF, a purchase request).

export const purchasesHref = (projectId: string) => `/dashboard/projects/${projectId}/compras`;

/** The project's Compras as a list of orders (the tab opens on its budget lines). */
export const ordersViewHref = (projectId: string) => `${purchasesHref(projectId)}?vista=pedidos`;

/** The project's purchase requests (Solicitudes). */
export const requestsViewHref = (projectId: string) => `${purchasesHref(projectId)}?vista=solicitudes`;

export const requestHref = (projectId: string, requestId: string) => `${purchasesHref(projectId)}/solicitudes/${requestId}`;

export const newRequestHref = (projectId: string) => `${purchasesHref(projectId)}/solicitudes/nueva`;

export const editRequestHref = (projectId: string, requestId: string) => `${requestHref(projectId, requestId)}/editar`;

/** The new-order form, filled in from an approved request. */
export const orderFromRequestHref = (projectId: string, requestId: string) =>
  `${purchasesHref(projectId)}/nuevo?solicitud=${encodeURIComponent(requestId)}`;

export const orderHref = (projectId: string, orderId: string) => `${purchasesHref(projectId)}/${orderId}`;

/** The new-order form, optionally on one chapter's lines. */
export const newOrderHref = (projectId: string, chapterCode?: string) =>
  `${purchasesHref(projectId)}/nuevo${chapterCode ? `?capitulo=${encodeURIComponent(chapterCode)}` : ""}`;

export const editOrderHref = (projectId: string, orderId: string) => `${orderHref(projectId, orderId)}/editar`;

/** One of the order's documents (its current version, or `versionId`), served by /api/v1 with the session. */
export const orderDocumentUrl = (orderId: string, documentId: string, versionId?: string) =>
  `/api/v1/purchases/${orderId}/documents/${documentId}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`;

/** The company-wide list (rail › Red › Compras), for Administration. */
export const COMPANY_PURCHASES_HREF = "/dashboard/compras";

/** Compras › Solicitudes: what the obras ask to buy, those to approve first. */
export const REQUESTS_HREF = `${COMPANY_PURCHASES_HREF}/solicitudes`;

/** Compras › Facturas: the suppliers' invoices of every obra. */
export const INVOICES_HREF = `${COMPANY_PURCHASES_HREF}/facturas`;

/** Compras › Pagos: what falls due, and the payments made. */
export const PAYMENTS_HREF = `${COMPANY_PURCHASES_HREF}/pagos`;

export const invoiceHref = (invoiceId: string) => `${INVOICES_HREF}/${invoiceId}`;

export const editInvoiceHref = (invoiceId: string) => `${invoiceHref(invoiceId)}/editar`;

/** The invoice form: on `orderId`, and as a credit note on `rectifiesId`. */
export function newInvoiceHref({ orderId, rectifiesId }: { orderId?: string; rectifiesId?: string } = {}) {
  const query = new URLSearchParams();
  if (orderId) query.set("pedido", orderId);
  if (rectifiesId) query.set("abono", rectifiesId);
  const text = query.toString();
  return `${INVOICES_HREF}/nueva${text ? `?${text}` : ""}`;
}

/** An invoice's PDF (its current version, or `fileId`), served by /api/v1 with the session. */
export const invoiceFileUrl = (invoiceId: string, fileId?: string) =>
  `/api/v1/purchases/invoices/${invoiceId}/file${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ""}`;

/** A payment's proof. */
export const paymentFileUrl = (paymentId: string) => `/api/v1/purchases/payments/${paymentId}/file`;
