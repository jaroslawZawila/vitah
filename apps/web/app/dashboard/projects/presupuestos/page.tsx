import { redirect } from "next/navigation";
import { getBudgetsOverview } from "../../../actions/budget";
import BudgetsScreen from "./BudgetsScreen";

/** Proyectos › Presupuestos: every obra's budget, each opening beside the others. */
export default async function BudgetsPage() {
  const overview = await getBudgetsOverview();
  if (!overview) redirect("/");
  return <BudgetsScreen overview={overview} />;
}
