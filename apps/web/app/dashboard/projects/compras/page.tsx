import { getProjects } from "../../../actions/projects";
import { toObraOptions } from "../components/obra-options";
import ObraPurchasesEntry from "./ObraPurchasesEntry";

/** Proyectos › Compras: first the section, then the obra (by code, client or address). */
export default async function ObraPurchasesPage() {
  const projects = await getProjects();
  return <ObraPurchasesEntry options={toObraOptions(projects)} />;
}
