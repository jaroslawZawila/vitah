// The ficha's tabs: shared by its server page (reading `?tab=`) and its client views.

export const COMPANY_TABS = ["resumen", "documentos", "trabajadores", "obras", "historial"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

export const isCompanyTab = (value: unknown): value is CompanyTab => COMPANY_TABS.includes(value as CompanyTab);
