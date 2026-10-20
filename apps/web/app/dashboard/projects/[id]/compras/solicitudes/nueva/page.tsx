import { redirect } from "next/navigation";
import { getPurchaseForm } from "../../../../../../actions/purchasing";
import { requestsViewHref } from "../../../components/purchasing/links";
import RequestFormScreen from "../../RequestFormScreen";

/** Compras › Nueva solicitud (admins and managers): what the obra needs, for approval. */
export default async function NewPurchaseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPurchaseForm(id);
  if (!result) redirect("/dashboard/projects");
  if (!result.canManage) redirect(requestsViewHref(id));
  return <RequestFormScreen projectId={id} form={result.form} />;
}
