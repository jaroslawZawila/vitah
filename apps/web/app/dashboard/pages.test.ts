import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import type { ReactElement } from "react";
import type { Ctx } from "@repo/core";
import { NOT_FOUND, TO_FORBIDDEN, TO_LOGIN, redirectTo } from "../../test/navigation";
import { signInAs } from "../../test/session";
import ClientsPage from "./clients/page";
import InvoicePage from "./compras/facturas/[invoiceId]/page";
import InvoicesPage from "./compras/facturas/page";
import PaymentsPage from "./compras/pagos/page";
import CompanyPurchasesPage from "./compras/page";
import ProjectLinesPage from "./projects/[id]/budget/(obras)/lines/page";
import ProjectBudgetPage from "./projects/[id]/budget/(obras)/page";
import BudgetPdfPage from "./projects/[id]/budget/pdf/page";
import ProjectDocumentsPage from "./projects/[id]/documents/page";
import ProjectPage from "./projects/[id]/page";
import ObraChapterPage from "./projects/[id]/obra/avance/[code]/page";
import ObraPage from "./projects/[id]/obra/page";
import EditPlanPage from "./projects/[id]/obra/planificacion/editar/page";
import ProjectHitoPage from "./projects/[id]/payments/[hitoId]/page";
import ProjectPaymentsPage from "./projects/[id]/payments/page";
import NewProjectPage from "./projects/new/page";
import ProjectsPage from "./projects/page";
import WorkersPage from "./subcontratas/trabajadores/page";
import UsersPage from "./users/page";

// What a page does when it can't show what was asked for: it used to send the
// visitor to another page without a word. Now a missing record is "No
// encontrado", a role that may not is "No tienes permiso", and no session is
// the login page; the redirects that are part of a flow stay.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
// NextAuth's own sign-in and sign-out (they need a request): the Users page's actions only import them.
vi.mock("@repo/auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("../../auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const search = <T extends Record<string, string>>(value: T) => ({ searchParams: Promise.resolve(value) });
/** What a page hands its screen. */
const propsOf = (page: ReactElement) => page.props as Record<string, unknown>;

async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, user, project };
}

beforeEach(resetDatabase);

describe("a record that isn't there", () => {
  it("is \"No encontrado\" on the project's tabs: another tenant's project, a deleted one, a stale link", async () => {
    const { project } = await setup();
    await setup();

    await expect(ProjectPage(params({ id: project.id }))).rejects.toEqual(NOT_FOUND);
    await expect(ProjectDocumentsPage(params({ id: project.id }))).rejects.toEqual(NOT_FOUND);
    await expect(ObraPage(params({ id: project.id }))).rejects.toEqual(NOT_FOUND);
    await expect(ProjectPage(params({ id: "no-such-project" }))).rejects.toEqual(NOT_FOUND);
    await expect(ProjectPaymentsPage(params({ id: project.id }))).rejects.toEqual(NOT_FOUND);
    await expect(ProjectHitoPage(params({ id: project.id, hitoId: "any" }))).rejects.toEqual(NOT_FOUND);
    await expect(ProjectBudgetPage({ ...params({ id: project.id }), ...search({}) })).rejects.toEqual(NOT_FOUND);
  });

  it("is \"No encontrado\" for a company-wide record too", async () => {
    await setup();

    await expect(InvoicePage(params({ invoiceId: "no-such-invoice" }))).rejects.toEqual(NOT_FOUND);
  });
});

describe("a link that went stale", () => {
  const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";

  it("shows the newest revision for a ?revision= that isn't there: the same tab without it, not an error", async () => {
    const { project } = await setup();
    const budget = `/dashboard/projects/${project.id}/budget`;
    const page = (query: Record<string, string>) => ({ ...params({ id: project.id }), ...search(query) });

    for (const revision of [NO_SUCH_ID, "discarded-draft"]) {
      await expect(ProjectBudgetPage(page({ revision }))).rejects.toEqual(redirectTo(budget));
      await expect(ProjectLinesPage(page({ revision, chapter: "03" }))).rejects.toEqual(redirectTo(`${budget}/lines?chapter=03`));
      // No such revision, no such PDF: the tab, on the newest.
      await expect(BudgetPdfPage(page({ revision, kind: "detailed" }))).rejects.toEqual(redirectTo(budget));
    }
    // Without the stale part the page is there.
    expect(propsOf((await ProjectBudgetPage(page({}))) as ReactElement)).toMatchObject({ projectId: project.id });
  });

  it("is still \"No encontrado\" when it is the project that isn't there, whatever ?revision= says", async () => {
    const { project } = await setup();
    await setup();

    await expect(ProjectBudgetPage({ ...params({ id: project.id }), ...search({ revision: NO_SUCH_ID }) })).rejects.toEqual(NOT_FOUND);
  });

  it("is \"No encontrado\" for a hito or a chapter that isn't there: nothing to fall back to", async () => {
    const { project } = await setup();

    for (const hitoId of [NO_SUCH_ID, "removed-hito"]) {
      await expect(ProjectHitoPage(params({ id: project.id, hitoId }))).rejects.toEqual(NOT_FOUND);
    }
    await expect(ObraChapterPage(params({ id: project.id, code: "99" }))).rejects.toEqual(NOT_FOUND);
  });
});

describe("a role that may not", () => {
  it("gets \"No tienes permiso\" instead of the list it was sent back to", async () => {
    await setup("viewer");
    await expect(NewProjectPage()).rejects.toEqual(TO_FORBIDDEN);

    await setup("manager");
    // The app's clients are the admins'.
    await expect(ClientsPage()).rejects.toEqual(TO_FORBIDDEN);
    // And so are the portal's users: no empty list for anyone else.
    await expect(UsersPage()).rejects.toEqual(TO_FORBIDDEN);
    await setup("viewer");
    await expect(UsersPage()).rejects.toEqual(TO_FORBIDDEN);
  });
});

describe("a page that can show what was asked for", () => {
  it("lists the projects, with \"new project\" for those who may create one", async () => {
    const { project } = await setup("manager");
    expect(propsOf(await ProjectsPage())).toMatchObject({ canCreate: true, projects: [{ id: project.id }] });

    await setup("viewer");
    expect(propsOf(await ProjectsPage())).toMatchObject({ canCreate: false, projects: [{ id: expect.any(String) }] });
  });

  it("lists nothing only when there is nothing: a tenant without projects or workers", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role: "viewer" });
    signInAs({ tenantId: tenant.id, userId: user.id, role: "viewer" });

    expect(propsOf(await ProjectsPage())).toMatchObject({ canCreate: false, projects: [] });
    expect(propsOf(await WorkersPage(search({})))).toMatchObject({
      canManage: false,
      page: { workers: [], paging: { page: 1, total: 0, pages: 1 }, counts: { all: 0 }, summary: { registered: 0 } },
      projects: [],
      companies: [],
    });
    // Compras' lists too: an empty first page, not an error.
    expect(propsOf(await CompanyPurchasesPage(search({})))).toMatchObject({ purchases: { orders: [], paging: { page: 1, total: 0, pages: 1 } } });
    expect(propsOf(await InvoicesPage(search({})))).toMatchObject({ canManage: false, invoices: { invoices: [], paging: { page: 1, total: 0, pages: 1 } } });
    expect(propsOf(await PaymentsPage(search({})))).toMatchObject({ canManage: false, payments: { payments: [], paging: { page: 1, total: 0, pages: 1 } } });
  });

  it("lists the users for an admin, saying which one they are", async () => {
    const { user } = await setup("admin");

    expect(propsOf(await UsersPage())).toMatchObject({ currentUserId: user.id, users: [{ id: user.id }] });
  });

  it("lists the workers, with the obras to filter by, editable by those who may", async () => {
    const { project } = await setup("manager");

    expect(propsOf(await WorkersPage(search({ obra: project.id })))).toMatchObject({
      canManage: true,
      query: { projectId: project.id, access: "all", companyId: "", query: "" },
      projects: [expect.objectContaining({ id: project.id })],
    });
  });

  it("reads a list's page and filters from the URL, and takes a mistyped one as none", async () => {
    const { project } = await setup("manager");

    expect(propsOf(await WorkersPage(search({ acceso: "blocked", empresa: "c-1", q: " ana ", page: "1" })))).toMatchObject({
      query: { projectId: "", access: "blocked", companyId: "c-1", query: "ana" },
      page: { workers: [], paging: { page: 1 } },
    });
    expect(propsOf(await CompanyPurchasesPage(search({ estado: "open", obra: project.id, tipo: "material", desde: "2026-10-01", retraso: "1", q: "piedra" })))).toMatchObject({
      query: { view: "orders", group: "open", projectId: project.id, kind: "material", from: "2026-10-01", to: "", lateOnly: true, query: "piedra", page: 1 },
      purchases: { orders: [], paging: { page: 1, total: 0 } },
    });
    expect(propsOf(await InvoicesPage(search({ estado: "overdue", proveedor: "s-1" })))).toMatchObject({
      query: { group: "overdue", supplierId: "s-1", page: 1 },
      invoices: { invoices: [] },
    });
    // Not a page, a state or a day: the first page of everything, never an error.
    expect(propsOf(await CompanyPurchasesPage(search({ estado: "nope", desde: "2026-13-40", page: "abc" })))).toMatchObject({
      query: { group: "all", from: "", page: 1 },
    });
    expect(propsOf(await PaymentsPage(search({ page: "0" })))).toMatchObject({ payments: { paging: { page: 1 } } });
  });
});

describe("no session", () => {
  it("is the login page", async () => {
    const { project } = await setup();
    signInAs(null);

    await expect(ObraPage(params({ id: project.id }))).rejects.toEqual(TO_LOGIN);
    await expect(ProjectPage(params({ id: project.id }))).rejects.toEqual(TO_LOGIN);
    await expect(ProjectDocumentsPage(params({ id: project.id }))).rejects.toEqual(TO_LOGIN);
    await expect(ProjectsPage()).rejects.toEqual(TO_LOGIN);
    await expect(UsersPage()).rejects.toEqual(TO_LOGIN);
    await expect(WorkersPage(search({}))).rejects.toEqual(TO_LOGIN);
    await expect(CompanyPurchasesPage(search({}))).rejects.toEqual(TO_LOGIN);
    await expect(InvoicesPage(search({}))).rejects.toEqual(TO_LOGIN);
    await expect(PaymentsPage(search({}))).rejects.toEqual(TO_LOGIN);
    await expect(NewProjectPage()).rejects.toEqual(TO_LOGIN);
    await expect(InvoicePage(params({ invoiceId: "any" }))).rejects.toEqual(TO_LOGIN);
  });
});

describe("a redirect that is part of a flow", () => {
  it("stays: the plan's editor without a draft goes back to the plan", async () => {
    const { project } = await setup();

    await expect(EditPlanPage(params({ id: project.id }))).rejects.toEqual(redirectTo(`/dashboard/projects/${project.id}/obra/planificacion`));
  });

  it("stays: a list's page past its end goes to the last one there is, with the same filters", async () => {
    const { project } = await setup();

    await expect(WorkersPage(search({ obra: project.id, page: "9" }))).rejects.toEqual(
      redirectTo(`/dashboard/subcontratas/trabajadores?obra=${project.id}`),
    );
    await expect(CompanyPurchasesPage(search({ estado: "open", page: "4" }))).rejects.toEqual(redirectTo("/dashboard/compras?estado=open"));
    await expect(InvoicesPage(search({ q: "msn", page: "2" }))).rejects.toEqual(redirectTo("/dashboard/compras/facturas?q=msn"));
    await expect(PaymentsPage(search({ page: "3" }))).rejects.toEqual(redirectTo("/dashboard/compras/pagos"));
  });
});
