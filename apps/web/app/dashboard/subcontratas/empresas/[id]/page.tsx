import { notFound } from "next/navigation";
import { getSupplierOrders } from "../../../../actions/purchasing";
import { getSubcontractor, getSubcontractorProjects } from "../../../../actions/subcontractors";
import { isCompanyTab, tabsOf } from "../../components/company/tabs";
import CompanyScreen from "./CompanyScreen";

/** Subcontratas › Empresas › ficha: a company's status, documents, workers, obras, orders and history. */
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [company, projects, orders] = await Promise.all([
    getSubcontractor(id),
    getSubcontractorProjects(),
    getSupplierOrders(id),
  ]);
  if (!company) notFound();
  const tabs = tabsOf(company.suppliesOnly);
  // A material supplier opens on its orders; any other company on its documents.
  const initialTab = isCompanyTab(tab) && tabs.includes(tab) ? tab : company.suppliesOnly ? "pedidos" : "documentos";
  return (
    <CompanyScreen
      company={company}
      projects={projects ?? []}
      orders={orders}
      initialTab={initialTab}
    />
  );
}
