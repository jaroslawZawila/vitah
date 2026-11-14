import { notFound } from "next/navigation";
import { forbidden } from "@/lib/access";
import { getSubcontractor } from "../../../../../actions/subcontractors";
import { companyDraftFrom } from "../../../components/fields/draft";
import EditCompanyScreen from "./EditCompanyScreen";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getSubcontractor(id);
  if (!company) notFound();
  if (!company.canManage) forbidden();
  // Only the form's fields go to the browser, not the documents and history.
  return <EditCompanyScreen id={id} initial={companyDraftFrom(company)} />;
}
