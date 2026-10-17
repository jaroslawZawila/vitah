import { notFound } from "next/navigation";
import { getSubcontractor, getSubcontractorProjects } from "../../../../actions/subcontractors";
import { isCompanyTab } from "../../components/company/tabs";
import CompanyScreen from "./CompanyScreen";

/** Subcontratas › Empresas › ficha: a company's status, documents, workers, obras and history. */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [company, projects] = await Promise.all([getSubcontractor(id), getSubcontractorProjects()]);
  if (!company) notFound();
  return (
    <CompanyScreen company={company} projects={projects ?? []} initialTab={isCompanyTab(tab) ? tab : "documentos"} />
  );
}
