import { redirect } from "next/navigation";

/** The old Proyectos › Compras de obra: the project list (Compras is a project tab, from any stage). */
export default function ObraPurchasesPage() {
  redirect("/dashboard/projects");
}
