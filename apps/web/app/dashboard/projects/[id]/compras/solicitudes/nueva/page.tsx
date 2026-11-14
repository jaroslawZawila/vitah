import { notFound } from "next/navigation";
import { forbidden } from "@/lib/access";
import { getPurchaseForm } from "../../../../../../actions/purchasing";
import RequestFormScreen from "../../RequestFormScreen";

/** Compras › Nueva solicitud (admins and managers): what the obra needs, for approval. */
export default async function NewPurchaseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPurchaseForm(id);
  if (!result) notFound();
  if (!result.canManage) forbidden();
  return <RequestFormScreen projectId={id} form={result.form} />;
}
