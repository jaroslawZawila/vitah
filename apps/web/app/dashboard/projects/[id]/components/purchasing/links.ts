// Where the Compras pages live (project tab, an order, its form, its PDF).

export const purchasesHref = (projectId: string) => `/dashboard/projects/${projectId}/compras`;

export const orderHref = (projectId: string, orderId: string) => `${purchasesHref(projectId)}/${orderId}`;

/** The new-order form, optionally on one chapter's lines. */
export const newOrderHref = (projectId: string, chapterCode?: string) =>
  `${purchasesHref(projectId)}/nuevo${chapterCode ? `?capitulo=${encodeURIComponent(chapterCode)}` : ""}`;

export const editOrderHref = (projectId: string, orderId: string) => `${orderHref(projectId, orderId)}/editar`;

/** The order's PDF, served by /api/v1 with the session. */
export const orderFileUrl = (orderId: string) => `/api/v1/purchases/${orderId}/file`;

/** The company-wide list (rail › Red › Compras), for Administration. */
export const COMPANY_PURCHASES_HREF = "/dashboard/compras";
