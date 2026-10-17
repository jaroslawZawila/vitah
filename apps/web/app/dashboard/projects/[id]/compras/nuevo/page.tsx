import { redirect } from "next/navigation";
import { getPurchaseForm } from "../../../../../actions/purchasing";
import { purchasesHref } from "../../components/purchasing/links";
import OrderFormScreen from "../OrderFormScreen";

/** Compras › Nuevo pedido (admins and managers). `?capitulo=` starts on that chapter's lines. */
export default async function NewPurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ capitulo?: string }>;
}) {
  const [{ id }, { capitulo }] = await Promise.all([params, searchParams]);
  const result = await getPurchaseForm(id);
  if (!result) redirect("/dashboard/projects");
  if (!result.canManage) redirect(purchasesHref(id));
  return <OrderFormScreen projectId={id} form={result.form} chapter={capitulo} />;
}
