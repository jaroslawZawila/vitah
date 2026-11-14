import { notFound } from "next/navigation";

/**
 * Any dashboard address no page answers (a mistyped or outdated link): "No
 * encontrado" inside the dashboard, the rail beside it, instead of the
 * whole-page one.
 */
export default function MissingDashboardPage() {
  notFound();
}
