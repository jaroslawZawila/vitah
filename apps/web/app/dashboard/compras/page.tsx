import { redirect } from "next/navigation";
import { getPurchases } from "../../actions/purchasing";
import ComprasScreen from "./ComprasScreen";

/** Compras (all obras): every order and subcontract of the company, for Administration. */
export default async function CompanyPurchasesPage() {
  const result = await getPurchases();
  if (!result) redirect("/dashboard");
  return <ComprasScreen purchases={result.purchases} />;
}
