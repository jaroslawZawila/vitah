import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { placeOf, type Place } from "./place";

const P = "/dashboard/projects/p-1";

describe("placeOf", () => {
  it.each<[string, Place]>([
    ["/dashboard", { title: "projects" }],
    ["/dashboard/projects", { title: "projects" }],
    ["/dashboard/projects/presupuestos", { title: "projects" }],
    ["/dashboard/projects/compras", { title: "projects" }],
    ["/dashboard/projects/new", { title: "newProject" }],
    [P, { title: "project", part: "projectTabs.general" }],
    [`${P}/budget`, { title: "project", part: "projectTabs.budget" }],
    [`${P}/budget/lines`, { title: "project", part: "projectTabs.budget" }],
    [`${P}/budget/pdf`, { title: "project", part: "projectTabs.budget" }],
    [`${P}/obra`, { title: "project", part: "projectTabs.obra" }],
    [`${P}/obra/avance/05`, { title: "project", part: "projectTabs.obra" }],
    [`${P}/obra/planificacion/editar`, { title: "project", part: "projectTabs.obra" }],
    [`${P}/photos`, { title: "project", part: "projectTabs.obra" }],
    [`${P}/compras`, { title: "project", part: "projectTabs.purchases" }],
    [`${P}/compras/o-1/modificado`, { title: "project", part: "projectTabs.purchases" }],
    [`${P}/compras/solicitudes/nueva`, { title: "project", part: "projectTabs.purchases" }],
    [`${P}/payments`, { title: "project", part: "projectTabs.payments" }],
    [`${P}/payments/h-1`, { title: "project", part: "projectTabs.payments" }],
    [`${P}/documents`, { title: "project", part: "projectTabs.documents" }],
    [`${P}/garantia`, { title: "project", part: "projectTabs.warranty" }],
    [`${P}/garantia/c-1`, { title: "project", part: "projectTabs.warranty" }],
    [`${P}/unknown`, { title: "project", part: undefined }],
    ["/dashboard/compras", { title: "purchases", part: "purchaseTabs.orders" }],
    ["/dashboard/compras/solicitudes", { title: "purchases", part: "purchaseTabs.requests" }],
    ["/dashboard/compras/facturas", { title: "purchases", part: "purchaseTabs.invoices" }],
    ["/dashboard/compras/facturas/nueva", { title: "purchases", part: "purchaseTabs.invoices" }],
    ["/dashboard/compras/facturas/i-1/editar", { title: "purchases", part: "purchaseTabs.invoices" }],
    ["/dashboard/compras/pagos", { title: "purchases", part: "purchaseTabs.payments" }],
    ["/dashboard/compras/proveedores/s-1", { title: "purchases", part: "purchaseTabs.suppliers" }],
    ["/dashboard/subcontratas", { title: "subcontractors", part: undefined }],
    ["/dashboard/subcontratas/empresas", { title: "subcontractors", part: "subcontractorTabs.companies" }],
    ["/dashboard/subcontratas/empresas/s-1/editar", { title: "subcontractors", part: "subcontractorTabs.companies" }],
    ["/dashboard/subcontratas/trabajadores/nuevo", { title: "subcontractors", part: "subcontractorTabs.workers" }],
    ["/dashboard/clients", { title: "clients" }],
    ["/dashboard/users", { title: "users" }],
    ["/dashboard/eliminados", { title: "deleted" }],
    ["/dashboard/contacto", { title: "officeContact" }],
    ["/dashboard/forbidden", { title: "forbidden" }],
    // An address no page answers: neutral, never another section's name.
    ["/dashboard/nothing-here", { title: "portal" }],
    ["/dashboard/constructor", { title: "portal" }],
    ["/", { title: "portal" }],
  ])("%s", (pathname, place) => {
    expect(placeOf(pathname)).toEqual(place);
  });

  // Every page there is, so a new section can't silently borrow a title: it is named, or this fails.
  const root = path.join(import.meta.dirname, "..");
  const pages = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return pages(full);
      return entry.name === "page.tsx" ? [dir] : [];
    });
  const addresses = pages(root)
    .map((dir) => path.relative(root, dir).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)))
    .filter((segments) => !segments.some((s) => s.startsWith("[...")))
    .map((segments) => ["", "dashboard", ...segments.map((s) => (s.startsWith("[") ? "x-1" : s))].join("/"));

  it("names every dashboard page", () => {
    expect(addresses.length).toBeGreaterThan(40);
    const unnamed = addresses.filter((address) => placeOf(address).title === "portal");
    expect(unnamed).toEqual([]);
    // Only the project list (and the old lists that now redirect to it) is "Proyectos".
    const projectList = addresses.filter((address) => placeOf(address).title === "projects");
    expect(projectList.sort()).toEqual(
      ["/dashboard", "/dashboard/projects", "/dashboard/projects/compras", "/dashboard/projects/presupuestos"].sort(),
    );
  });

  it("names the page within a section that has several", () => {
    const sections = new Set(["project", "purchases"]);
    const vague = addresses.filter((address) => {
      const place = placeOf(address);
      return sections.has(place.title) && !place.part;
    });
    expect(vague).toEqual([]);
  });
});
