import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetRevisions, clientProfiles, db, eq, projects } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { budgetIssueService as issue, budgetService as svc, type Ctx } from "../src";
import { compareIdentity, namesValue, projectIdentity, withProjectIdentity } from "../src/budget-identity";
import { defaultTexts } from "../src/budget-template";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

const ADDRESS = "Polígono 501, Parcela 104, Caviedes-Corrales, 39592 Valdáliga (Cantabria)";

/** A project whose client has a profile (Fernando Barcenilla) unless `client: false`. */
async function setup({ client = true, role = "manager" as Ctx["role"] } = {}) {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  let clientUserId: string | null = null;
  if (client) {
    // The account's name is older than the profile's: the profile wins.
    const account = await createTestUser(tenant.id, { role: "client", name: "Cliente" });
    await db.insert(clientProfiles).values({ userId: account.id, tenantId: tenant.id, firstName: "Fernando", surnames: "Barcenilla" });
    clientUserId = account.id;
  }
  const project = await createTestProject(tenant.id, { address: ADDRESS, clientUserId });
  return { tenant, ctx, project };
}

const revisionOf = async (ctx: Ctx, projectId: string, revisionId?: string) =>
  (await svc.getBudget(ctx, projectId, revisionId)).revision!;

const setCover = (ctx: Ctx, projectId: string, revisionId: string, cover: Record<string, string>) =>
  svc.updateRevision(ctx, projectId, revisionId, { texts: { cover } });

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("comparing a cover with the project", () => {
  it("sets aside case, accents, punctuation and spaces", () => {
    expect(namesValue("polígono 501 · parcela 104 · CAVIEDES CORRALES · 39592 valdaliga, cantabria", ADDRESS)).toBe(true);
    expect(namesValue("Calle Castelar12", "Calle Castelar 12")).toBe(true);
    expect(namesValue("", "Calle Castelar 12")).toBe(false);
  });

  it("takes a text that says the same and more, never a different number or name", () => {
    expect(namesValue("D. Fernando Barcenilla, en calidad de autopromotor de vivienda habitual", "Fernando Barcenilla")).toBe(true);
    expect(namesValue("Calle Mayor 12, Santander", "Calle Mayor 1, Santander")).toBe(false);
    expect(namesValue("D. Fernando Barcenilla", "Ana Peña Ruiz")).toBe(false);
    // The same words in another order are another plot, or another person.
    expect(namesValue("Polígono 104, Parcela 501", "Polígono 501, Parcela 104")).toBe(false);
    expect(namesValue("Barcenilla Fernando", "Fernando Barcenilla")).toBe(false);
    expect(namesValue("Polígono 501, nº catastral 7, Parcela 104", "Polígono 501, Parcela 104")).toBe(true);
  });

  it("lists what differs, and what the budget names that the project lacks", () => {
    const cover = { ...defaultTexts().cover, promoter: "D. Luis Gómez", site: "Calle Castelar 12, Santander" };
    expect(compareIdentity(cover, { client: "Fernando Barcenilla", address: ADDRESS })).toEqual({
      client: "Fernando Barcenilla",
      address: ADDRESS,
      differs: ["promoter", "site"],
      projectLacks: [],
    });
    expect(compareIdentity(cover, { client: null, address: ADDRESS })).toMatchObject({ differs: ["site"], projectLacks: ["promoter"] });
    // Nothing on either side: nothing to say.
    expect(compareIdentity(defaultTexts().cover, { client: " ", address: null })).toMatchObject({ client: null, differs: [], projectLacks: [] });
    expect(withProjectIdentity(cover, { client: null, address: ADDRESS })).toMatchObject({ promoter: "D. Luis Gómez", site: ADDRESS });
  });
});

describe("a new draft", () => {
  it("by hand names the project's client (from their profile) and address", async () => {
    const { ctx, project } = await setup();

    await svc.createBudget(ctx, project.id, {});

    const revision = await revisionOf(ctx, project.id);
    expect(revision.texts.cover).toMatchObject({ promoter: "Fernando Barcenilla", site: ADDRESS, cadastral: "" });
    expect(revision.identity).toEqual({ client: "Fernando Barcenilla", address: ADDRESS, differs: [], projectLacks: [] });
  });

  it("leaves the promoter empty for a project without a client, and says when the budget names one", async () => {
    const { ctx, project } = await setup({ client: false });
    const { revisionId } = await svc.createBudget(ctx, project.id, {});
    expect((await revisionOf(ctx, project.id)).texts.cover).toMatchObject({ promoter: "", site: ADDRESS });

    await setCover(ctx, project.id, revisionId, { promoter: "D. Luis Gómez" });

    expect((await revisionOf(ctx, project.id)).identity).toMatchObject({ client: null, differs: [], projectLacks: ["promoter"] });
    // Never written to the project.
    const [row] = await db.select({ clientUserId: projects.clientUserId }).from(projects).where(eq(projects.id, project.id));
    expect(row!.clientUserId).toBeNull();
  });

  it("copied from the revision before takes the project's data as it is now, keeping a text that says more", async () => {
    const { ctx, project } = await setup();
    const { revisionId } = await svc.createBudget(ctx, project.id, {});
    const formal = "D. Fernando Barcenilla, en calidad de autopromotor de vivienda habitual";
    await setCover(ctx, project.id, revisionId, { promoter: formal });
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    // The project's address is corrected after the issue.
    await db.update(projects).set({ address: "Barrio Caviedes 12, 39592 Valdáliga" }).where(eq(projects.id, project.id));

    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);

    const draft = await revisionOf(ctx, project.id, rev1);
    expect(draft.texts.cover).toMatchObject({ promoter: formal, site: "Barrio Caviedes 12, 39592 Valdáliga" });
    expect(draft.identity?.differs).toEqual([]);
    // The issued one is untouched, and says the project now differs.
    const issued = await revisionOf(ctx, project.id, revisionId);
    expect(issued.texts.cover.site).toBe(ADDRESS);
    expect(issued.identity).toMatchObject({ address: "Barrio Caviedes 12, 39592 Valdáliga", differs: ["site"] });
  });
});

describe("takeProjectData", () => {
  it("copies the project's client and address into the draft where they differ, and only there", async () => {
    const { ctx, project } = await setup();
    const { revisionId } = await svc.createBudget(ctx, project.id, {});
    await setCover(ctx, project.id, revisionId, { promoter: "D. Luis Gómez", site: "Calle Castelar 12, Santander", cadastral: "Ref. 39091A" });
    expect((await revisionOf(ctx, project.id)).identity?.differs).toEqual(["promoter", "site"]);

    expect(await svc.takeProjectData(ctx, project.id, revisionId)).toEqual({ revisionId, changed: ["promoter", "site"] });

    const revision = await revisionOf(ctx, project.id);
    expect(revision.texts.cover).toMatchObject({ promoter: "Fernando Barcenilla", site: ADDRESS, cadastral: "Ref. 39091A" });
    expect(revision.identity?.differs).toEqual([]);
    // Again: nothing left to take.
    expect(await svc.takeProjectData(ctx, project.id, revisionId)).toEqual({ revisionId, changed: [] });
  });

  it("keeps a promoter that names the client and says more", async () => {
    const { ctx, project } = await setup();
    const { revisionId } = await svc.createBudget(ctx, project.id, {});
    await setCover(ctx, project.id, revisionId, { promoter: "D. Fernando Barcenilla", site: "Otra calle 5" });

    expect((await svc.takeProjectData(ctx, project.id, revisionId)).changed).toEqual(["site"]);
    expect((await revisionOf(ctx, project.id)).texts.cover).toMatchObject({ promoter: "D. Fernando Barcenilla", site: ADDRESS });
  });

  it("refuses an issued or accepted revision: it was given to the client", async () => {
    const { ctx, project } = await setup();
    const { revisionId } = await svc.createBudget(ctx, project.id, {});
    await setCover(ctx, project.id, revisionId, { site: "Calle Castelar 12, Santander" });
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });

    await expect(svc.takeProjectData(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_draft", status: 409 });
    await svc.acceptRevision(ctx, project.id, revisionId);
    await expect(svc.takeProjectData(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_draft" });
    const [row] = await db.select({ texts: budgetRevisions.texts }).from(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
    expect((row!.texts as { cover: { site: string } }).cover.site).toBe("Calle Castelar 12, Santander");
  });

  it("is for editors, within their tenant", async () => {
    const { tenant, ctx, project } = await setup();
    const { revisionId } = await svc.createBudget(ctx, project.id, {});
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const other = await setup();

    await expect(svc.takeProjectData({ tenantId: tenant.id, userId: viewer.id, role: "viewer" }, project.id, revisionId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.takeProjectData(other.ctx, project.id, revisionId)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.takeProjectData(other.ctx, other.project.id, revisionId)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("projectIdentity", () => {
  it("reads only the tenant's own project and client", async () => {
    const { tenant, project } = await setup();
    const other = await setup();
    expect(await projectIdentity(tenant.id, project.id)).toEqual({ client: "Fernando Barcenilla", address: ADDRESS });
    expect(await projectIdentity(other.tenant.id, project.id)).toEqual({ client: null, address: null });
    // A client of another tenant is never named, whatever the project row says.
    const stranger = await createTestUser(other.tenant.id, { role: "client", name: "Otro Cliente" });
    await db.update(projects).set({ clientUserId: stranger.id }).where(eq(projects.id, project.id));
    expect(await projectIdentity(tenant.id, project.id)).toEqual({ client: null, address: ADDRESS });
  });

  it("names nothing of a deleted project", async () => {
    const { tenant, project } = await setup();
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));
    expect(await projectIdentity(tenant.id, project.id)).toEqual({ client: null, address: null });
  });
});
