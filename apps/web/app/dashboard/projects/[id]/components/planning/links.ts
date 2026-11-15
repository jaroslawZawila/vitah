// Server-safe: the draft editor's page redirects with it, so it can't call ObraFrame's
// `obraHref` (a "use client" module, which a server component can't call).

/** Obra › Planificación, its draft editor and its versions. */
export const planningHref = (projectId: string, page?: "editar" | "versiones") =>
  `/dashboard/projects/${projectId}/obra/planificacion${page ? `/${page}` : ""}`;
