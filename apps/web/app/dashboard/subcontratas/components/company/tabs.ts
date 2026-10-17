// The ficha's tabs: shared by its server page (reading `?tab=`) and its client views.

export const COMPANY_TABS = ["resumen", "documentos", "trabajadores", "obras", "pedidos", "historial"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];

/** A material supplier's ficha: no CAE documents, workers or obras. */
export const SUPPLIER_TABS = ["resumen", "pedidos", "historial"] as const satisfies readonly CompanyTab[];

export const isCompanyTab = (value: unknown): value is CompanyTab => COMPANY_TABS.includes(value as CompanyTab);

/** The tabs a company's ficha has. */
export const tabsOf = (suppliesOnly: boolean): readonly CompanyTab[] => (suppliesOnly ? SUPPLIER_TABS : COMPANY_TABS);
