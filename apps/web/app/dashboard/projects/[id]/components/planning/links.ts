import { obraHref } from "../construction/ObraFrame";

/** Obra › Planificación, its draft editor and its versions. */
export const planningHref = (projectId: string, page?: "editar" | "versiones") =>
  `${obraHref(projectId, "planning")}${page ? `/${page}` : ""}`;
