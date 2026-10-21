// The obras a section's picker chooses from (Proyectos › Compras): code,
// client and address, and how a typed search matches them.

export type ObraOption = {
  id: string;
  ref: string;
  address: string;
  clientName: string | null;
  /** Its code, client and address folded once (lower case, no accents), for matching. */
  search: string;
};

/** Lower case, without accents: "Peñacastillo" is found as "penacastillo". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** The projects as the picker shows them: the client by name, else by email. */
export function toObraOptions(
  projects: { id: string; ref: string; address: string; client: { name: string | null; email: string } | null }[],
): ObraOption[] {
  return projects.map((p) => {
    const clientName = p.client ? (p.client.name ?? p.client.email) : null;
    return { id: p.id, ref: p.ref, address: p.address, clientName, search: fold([p.ref, clientName ?? "", p.address].join(" ")) };
  });
}

/** Whether every word typed is in the obra's code, client or address. */
export function matchesObra(option: ObraOption, query: string) {
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => option.search.includes(word));
}
