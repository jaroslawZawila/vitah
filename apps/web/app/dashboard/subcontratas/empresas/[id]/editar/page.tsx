import { notFound, redirect } from "next/navigation";
import { getSubcontractor } from "../../../../../actions/subcontractors";
import { companyHref } from "../../../components/display";
import { companyDraftFrom } from "../../../components/fields/draft";
import EditCompanyScreen from "./EditCompanyScreen";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getSubcontractor(id);
  if (!company) notFound();
  if (!company.canManage) redirect(companyHref(id));
  // Only the form's fields go to the browser, not the documents and history.
  return <EditCompanyScreen id={id} initial={companyDraftFrom(company)} />;
}
