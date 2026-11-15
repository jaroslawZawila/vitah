import { foldAccents } from "@repo/core/format";

// The obras a picker or the project list searches (the Compras and budget
// pickers, Proyectos): code, client and address, and how a typed search
// matches them.

export type ObraOption = {
  id: string;
  ref: string;
  address: string;
  clientName: string | null;
  /** Its code, client and address folded once (lower case, no accents), for matching. */
  search: string;
};


/** An obra as the picker shows it, with its folded search text. */
export function toObraOption(obra: Omit<ObraOption, "search">): ObraOption {
  return { ...obra, search: foldAccents([obra.ref, obra.clientName ?? "", obra.address].join(" ")) };
}

type ProjectLike = { id: string; ref: string; address: string; client: { name: string | null; email: string } | null };

/** A project as the picker shows it: the client by name, else by email. */
export const projectObraOption = (p: ProjectLike): ObraOption =>
  toObraOption({ id: p.id, ref: p.ref, address: p.address, clientName: p.client ? (p.client.name ?? p.client.email) : null });

export const toObraOptions = (projects: ProjectLike[]): ObraOption[] => projects.map(projectObraOption);

/** Whether every word typed is in the obra's code, client or address. */
export function matchesObra(option: ObraOption, query: string) {
  return foldAccents(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => option.search.includes(word));
}
