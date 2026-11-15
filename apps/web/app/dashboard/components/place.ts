// Where in the portal an address is, for the top bar and the browser tab: the one place that
// knows it, so a new section is named or, until it is added here, gets the neutral "Portal",
// never another section's title.

/** A section's title: `topbar.titles.<key>`. */
export type PlaceTitle =
  | "portal"
  | "projects"
  | "newProject"
  | "project"
  | "clients"
  | "users"
  | "subcontractors"
  | "purchases"
  | "deleted"
  | "officeContact"
  | "forbidden";

/** A project's tabs in the rail's order, by their path under the project ("" is General). */
export const PROJECT_TABS = [
  { key: "general", path: "" },
  { key: "budget", path: "/budget" },
  { key: "obra", path: "/obra" },
  { key: "purchases", path: "/compras" },
  { key: "payments", path: "/payments" },
  { key: "documents", path: "/documents" },
  { key: "warranty", path: "/garantia" },
] as const;

type ProjectTab = (typeof PROJECT_TABS)[number]["key"];

/** The page within its section, as the rail names it: `sidebar.<key>`. */
export type PlacePart =
  | `projectTabs.${ProjectTab}`
  | `purchaseTabs.${"requests" | "orders" | "invoices" | "payments" | "suppliers"}`
  | `subcontractorTabs.${"companies" | "workers"}`;

export type Place = { title: PlaceTitle; part?: PlacePart };

/** A project's tab by its first path segment, none for General (`photos` is the old address of Obra › Fotos). */
function projectTab(segment: string | undefined): PlacePart | undefined {
  if (segment === "photos") return "projectTabs.obra";
  const path = segment === undefined ? "" : `/${segment}`;
  const tab = PROJECT_TABS.find((t) => t.path === path);
  return tab && `projectTabs.${tab.key}`;
}

const PURCHASE_TABS: Record<string, PlacePart> = {
  solicitudes: "purchaseTabs.requests",
  facturas: "purchaseTabs.invoices",
  pagos: "purchaseTabs.payments",
  proveedores: "purchaseTabs.suppliers",
};

const SUBCONTRACTOR_TABS: Record<string, PlacePart> = {
  empresas: "subcontractorTabs.companies",
  trabajadores: "subcontractorTabs.workers",
};

/** Sections with no pages of their own to name. */
const SECTIONS: Record<string, PlaceTitle> = {
  clients: "clients",
  users: "users",
  eliminados: "deleted",
  contacto: "officeContact",
  forbidden: "forbidden",
};

const own = <T>(map: Record<string, T>, key: string | undefined) =>
  key !== undefined && Object.hasOwn(map, key) ? map[key] : undefined;

/** The place a dashboard address (a pathname, no query) is in. */
export function placeOf(pathname: string): Place {
  const [root, section, first, second] = pathname.split("/").filter(Boolean);
  if (root !== "dashboard") return { title: "portal" };
  switch (section) {
    case undefined:
    case "projects":
      // The old company-wide Presupuestos and Compras lists now redirect to the project list.
      if (first === undefined || first === "presupuestos" || first === "compras") return { title: "projects" };
      if (first === "new") return { title: "newProject" };
      return { title: "project", part: projectTab(second) };
    case "compras":
      return { title: "purchases", part: first === undefined ? "purchaseTabs.orders" : own(PURCHASE_TABS, first) };
    case "subcontratas":
      return { title: "subcontractors", part: own(SUBCONTRACTOR_TABS, first) };
    default:
      return { title: own(SECTIONS, section) ?? "portal" };
  }
}
