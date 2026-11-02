import { redirect } from "next/navigation";

/** The old Proyectos › Presupuestos: the project list, whose Presupuesto filter replaced it. */
export default function BudgetsPage() {
  redirect("/dashboard/projects");
}
