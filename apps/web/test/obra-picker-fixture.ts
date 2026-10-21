import { toObraOptions } from "../app/dashboard/projects/components/obra-options";

// Three obras for the obra pickers: Caviedes (Ana Peña Ruiz), Comillas (Luis
// Gómez) and Suances (no client yet).

export const obraOptions = toObraOptions([
  { id: "p-1", ref: "VTH-26-001", address: "Barrio Caviedes 12, Valdáliga", client: { name: "Ana Peña Ruiz", email: "ana@vitah.es" } },
  { id: "p-2", ref: "VTH-26-002", address: "Calle Real 3, Comillas", client: { name: "Luis Gómez", email: "luis@vitah.es" } },
  { id: "p-3", ref: "VTH-26-003", address: "Avenida de Suances 8", client: null },
]);
