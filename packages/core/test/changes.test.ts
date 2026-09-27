import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDocument,
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { db, eq, projects } from "@repo/db";
import {
  budgetService,
  changesService as svc,
  CHANGE_AREAS,
  documentsService,
  hitosService,
  obraService,
  photosService,
  projectClientService,
  projectsService,
  type ChangeArea,
  type Ctx,
} from "../src";
import { files, testImage } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = () => new File(["%PDF-1.7 acta"], "acta.pdf", { type: "application/pdf" });

/** A project with a client, an accepted budget of chapters 01–02 and its hitos. */
async function setup() {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role: "admin" };
  const { revisionId } = await budgetService.createBudget(ctx, project.id, {});
  for (const code of ["01", "02"]) {
    const { chapterId } = await budgetService.addChapter(ctx, project.id, revisionId, {
      code,
      name: `Capítulo ${code}`,
    });
    await budgetService.addLine(ctx, project.id, chapterId, {
      code: `${code}.01`,
      description: "Partida",
      unit: "pa",
      quantity: 1,
      unitPriceCents: 100_000,
    });
  }
  await budgetService.acceptRevision(ctx, project.id, revisionId);
  const hitos = await hitosService.listHitos(ctx, project.id);
  const hito = hitos.find((h) => h.code === "H2")!;
  return { tenant, client, project, ctx, hito };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function counters(projectId: string) {
  const [row] = await db
    .select({
      project: projects.projectRev,
      obra: projects.obraRev,
      photos: projects.photosRev,
      documents: projects.documentsRev,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row!;
}

/** Runs `write` and returns which counters of the project it moved. */
async function areasMovedBy(projectId: string, write: () => Promise<unknown>) {
  const before = await counters(projectId);
  await write();
  const after = await counters(projectId);
  return CHANGE_AREAS.filter((area) => after[area] !== before[area]);
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

afterEach(() => vi.restoreAllMocks());

// Each case prepares what it needs, then returns the write to measure.
type Case = [string, readonly ChangeArea[], (s: Setup) => Promise<() => Promise<unknown>>];

const cases: Case[] = [
  [
    "updateProject",
    ["project"],
    async ({ ctx, project }) =>
      () => projectsService.updateProject(ctx, project.id, { completionDate: "2027-06-30" }),
  ],
  [
    "assignProjectClient",
    CHANGE_AREAS,
    async ({ ctx, project, client }) => {
      await projectClientService.unassignProjectClient(ctx, project.id);
      return () => projectClientService.assignProjectClient(ctx, project.id, { clientId: client.id });
    },
  ],
  [
    "setStage",
    ["obra"],
    async ({ ctx, project }) => () => obraService.setStage(ctx, project.id, { stage: 6 }),
  ],
  [
    "addPhoto",
    ["photos"],
    async ({ ctx, project }) => {
      const file = await testImage();
      return () => photosService.addPhoto(ctx, project.id, { file });
    },
  ],
  [
    "deletePhoto",
    ["photos"],
    async ({ ctx, project, tenant }) => {
      const photo = await createTestPhoto(tenant.id, project.id);
      return () => photosService.deletePhoto(ctx, project.id, photo.id);
    },
  ],
  [
    "addDocument",
    ["documents"],
    async ({ ctx, project }) =>
      () =>
        documentsService.addDocument(ctx, project.id, { title: "Contrato", category: "contract", file: pdf() }),
  ],
  [
    "deleteDocument",
    ["documents"],
    async ({ ctx, project, tenant }) => {
      const doc = await createTestDocument(tenant.id, project.id);
      return () => documentsService.deleteDocument(ctx, project.id, doc.id);
    },
  ],
  [
    "acceptRevision",
    ["obra"],
    async ({ ctx, project }) => {
      const { revisionId } = await budgetService.createRevision(ctx, project.id);
      return () => budgetService.acceptRevision(ctx, project.id, revisionId);
    },
  ],
  [
    "setProgress",
    ["obra"],
    async ({ ctx, project }) => {
      const { revision } = await budgetService.getBudget(ctx, project.id);
      const id = revision!.chapters[0]!.lines[0]!.id;
      return () => budgetService.setProgress(ctx, project.id, { lines: [{ id, executedPct: 40 }] });
    },
  ],
  [
    "a draft's edits",
    [],
    async ({ ctx, project }) => {
      const { revisionId } = await budgetService.createRevision(ctx, project.id);
      return async () => {
        const { chapterId } = await budgetService.addChapter(ctx, project.id, revisionId, {
          code: "03",
          name: "Nuevo",
        });
        await budgetService.updateRevision(ctx, project.id, revisionId, { reference: "040/2026" });
        await budgetService.deleteChapter(ctx, project.id, chapterId);
      };
    },
  ],
  [
    "updateHito",
    ["obra"],
    async ({ ctx, project, hito }) => () => hitosService.updateHito(ctx, project.id, hito.id, { name: "Estructura" }),
  ],
  [
    "updatePlan",
    ["obra"],
    async ({ ctx, project, hito }) =>
      () => hitosService.updatePlan(ctx, project.id, { hitos: [{ id: hito.id, chapterCodes: ["01"] }] }),
  ],
  [
    "updatePlan without changes",
    [],
    async ({ ctx, project, hito }) => () => hitosService.updatePlan(ctx, project.id, { hitos: [{ id: hito.id }] }),
  ],
  [
    "updateHito without changes",
    [],
    async ({ ctx, project, hito }) => () => hitosService.updateHito(ctx, project.id, hito.id, {}),
  ],
  [
    "addCheck",
    ["obra"],
    async ({ ctx, project, hito }) => () => hitosService.addCheck(ctx, project.id, hito.id, { label: "Prueba" }),
  ],
  [
    "updateCheck",
    ["obra"],
    async ({ ctx, project, hito }) => {
      const { checkId } = await hitosService.addCheck(ctx, project.id, hito.id, { label: "Prueba" });
      return () => hitosService.updateCheck(ctx, project.id, checkId, { done: true });
    },
  ],
  [
    "updateCheck without changes",
    [],
    async ({ ctx, project, hito }) => {
      const { checkId } = await hitosService.addCheck(ctx, project.id, hito.id, { label: "Prueba" });
      return () => hitosService.updateCheck(ctx, project.id, checkId, {});
    },
  ],
  [
    "deleteCheck",
    ["obra"],
    async ({ ctx, project, hito }) => {
      const { checkId } = await hitosService.addCheck(ctx, project.id, hito.id, { label: "Prueba" });
      return () => hitosService.deleteCheck(ctx, project.id, checkId);
    },
  ],
  [
    "setActaPhotos",
    ["obra"],
    async ({ ctx, project, hito, tenant }) => {
      const photo = await createTestPhoto(tenant.id, project.id);
      return () => hitosService.setActaPhotos(ctx, project.id, hito.id, { photoIds: [photo.id] });
    },
  ],
  [
    "uploadHitoFile",
    ["obra"],
    async ({ ctx, project, hito }) =>
      () => hitosService.uploadHitoFile(ctx, project.id, hito.id, "acta", { file: pdf(), date: "2026-09-24" }),
  ],
  [
    "removeHitoFile",
    ["obra"],
    async ({ ctx, project, hito }) => {
      await hitosService.uploadHitoFile(ctx, project.id, hito.id, "invoice", { file: pdf() });
      return () => hitosService.removeHitoFile(ctx, project.id, hito.id, "invoice");
    },
  ],
  [
    "registerPayment",
    ["obra"],
    async ({ ctx, project, hito }) =>
      () => hitosService.registerPayment(ctx, project.id, hito.id, { paidOn: "2026-09-25" }),
  ],
  [
    "cancelPayment",
    ["obra"],
    async ({ ctx, project, hito }) => {
      await hitosService.registerPayment(ctx, project.id, hito.id, { paidOn: "2026-09-25" });
      return () => hitosService.cancelPayment(ctx, project.id, hito.id);
    },
  ],
];

describe("writes the client sees", () => {
  it.each(cases)("%s moves %j", async (_, areas, prepare) => {
    const s = await setup();
    const write = await prepare(s);

    expect(await areasMovedBy(s.project.id, write)).toEqual(areas);
  });

  it("createBudget moves the obra (its new hitos)", async () => {
    const { ctx, tenant } = await setup();
    const project = await createTestProject(tenant.id);

    expect(
      await areasMovedBy(project.id, () => budgetService.createBudget(ctx, project.id, {})),
    ).toEqual(["obra"]);
  });

  // Writes that need no mark: the app sees a new, lost or deleted project through
  // its id (createProject, deleteProject, unassignProjectClient); createBudget
  // marks for createDefaultHitos; the client never sees a budget draft.
  const UNMARKED = new Set([
    "createProject",
    "deleteProject",
    "unassignProjectClient",
    "createDefaultHitos",
    "createRevision",
    "updateRevision",
    "deleteRevision",
    "addChapter",
    "updateChapter",
    "deleteChapter",
    "addLine",
    "updateLine",
    "deleteLine",
    // Helpers, not writes.
    "projectInTenant",
    "clientProjectWhere",
    "requireAssignableClient",
    "clientConflict",
    "toBudgetChapters",
    "photosByChapter",
  ]);

  it("covers every write of the services the app shows", () => {
    const services = [
      projectsService,
      projectClientService,
      obraService,
      photosService,
      documentsService,
      budgetService,
      hitosService,
    ];
    const covered = new Set([...cases.map(([name]) => name), "createBudget"]);
    const unchecked = services
      .flatMap((service) => Object.keys(service))
      .filter((name) => !/^(list|get|open)[A-Z]/.test(name))
      .filter((name) => !covered.has(name) && !UNMARKED.has(name));

    // A new write the client sees needs a case above (and a markChanged call).
    expect(unchecked).toEqual([]);
  });

  it("a failed write moves nothing", async () => {
    const { ctx, project } = await setup();

    expect(
      await areasMovedBy(project.id, () =>
        obraService.setStage(ctx, project.id, { stage: 99 }).catch(() => {}),
      ),
    ).toEqual([]);
  });
});

describe("markChanged", () => {
  it("adds one to each given counter", async () => {
    const { tenant, project } = await setup();
    const before = await counters(project.id);

    await svc.markChanged(tenant.id, project.id, ["photos", "documents"]);
    await svc.markChanged(tenant.id, project.id, ["photos"]);

    expect(await counters(project.id)).toEqual({
      ...before,
      photos: before.photos + 2,
      documents: before.documents + 1,
    });
  });

  it("doesn't touch another tenant's project", async () => {
    const { project } = await setup();
    const other = await createTestTenant();
    const before = await counters(project.id);

    await svc.markChanged(other.id, project.id, CHANGE_AREAS);

    expect(await counters(project.id)).toEqual(before);
  });

  it("never fails the caller", async () => {
    const { tenant, project } = await setup();
    vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("database down");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(svc.markChanged(tenant.id, project.id, ["obra"])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});

describe("getClientChanges", () => {
  it("returns the counters of the client's project", async () => {
    const { tenant, client, project } = await setup();
    await svc.markChanged(tenant.id, project.id, ["documents"]);

    const { project: p, obra, photos, documents } = await counters(project.id);

    expect(await svc.getClientChanges(tenant.id, client.id)).toEqual({
      projectId: project.id,
      project: p,
      obra: obra + p + photos,
      photos,
      documents,
    });
  });

  it("returns null without a project", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect(await svc.getClientChanges(tenant.id, client.id)).toBeNull();
  });

  it("returns null once the client is removed from the project", async () => {
    const { tenant, client, project, ctx } = await setup();

    await projectClientService.unassignProjectClient(ctx, project.id);

    expect(await svc.getClientChanges(tenant.id, client.id)).toBeNull();
  });

  it("never reaches across tenants", async () => {
    const { client } = await setup();
    const other = await createTestTenant();

    expect(await svc.getClientChanges(other.id, client.id)).toBeNull();
  });

  it("moves the obra with the project and its photos, which it shows too", async () => {
    const { tenant, client, project } = await setup();
    const obra = async () => (await svc.getClientChanges(tenant.id, client.id))!.obra;
    const start = await obra();

    await svc.markChanged(tenant.id, project.id, ["project"]);
    await svc.markChanged(tenant.id, project.id, ["photos"]);
    await svc.markChanged(tenant.id, project.id, ["documents"]);

    expect(await obra()).toBe(start + 2);
  });
});
