import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pushTokens } from "@repo/db";
import {
  createTestDocument,
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { clientAccountService, documentsService, photosService, type Ctx } from "../src";
import { notifyProjectClient } from "../src/notifications";
import { files, testImage } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/push", () => ({ sendPush: vi.fn(async () => []) }));
const { sendPush } = await import("../src/push");

const TOKEN = "ExponentPushToken[phone-1]";
let photo: File;
const pdf = () => new File(["%PDF-1.7\n"], "c.pdf", { type: "application/pdf" });

beforeAll(async () => {
  photo = await testImage("jpeg", 200, 150);
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(sendPush).mockReset().mockResolvedValue([]);
});

/** A project whose client has registered a phone. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  await clientAccountService.registerPushToken(tenant.id, client.id, { token: TOKEN });
  return { tenant, client, project, ctx };
}

const addPhoto = (ctx: Ctx, projectId: string) =>
  photosService.addPhoto(ctx, projectId, { file: photo });
const addDocument = (ctx: Ctx, projectId: string) =>
  documentsService.addDocument(ctx, projectId, {
    title: "Planos",
    category: "plans",
    file: pdf(),
  });

describe("notifying the client", () => {
  it("pushes a moved handover date, opening the Obra tab, unless progress notices are off", async () => {
    const { tenant, client, project } = await setup();

    await notifyProjectClient(tenant.id, project.id, { kind: "delivery", date: "2026-12-23" });
    expect(sendPush).toHaveBeenCalledWith([
      {
        to: TOKEN,
        title: "Nueva fecha de entrega",
        body: "La entrega prevista de tu vivienda es ahora el 23 de diciembre de 2026.",
        data: { screen: "obra" },
      },
    ]);

    vi.mocked(sendPush).mockClear();
    await clientAccountService.updateSettings(tenant.id, client.id, { notifications: { progress: false } });
    await notifyProjectClient(tenant.id, project.id, { kind: "delivery", date: "2027-01-15" });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("pushes new photos and documents to the client's phones", async () => {
    const { project, ctx } = await setup();

    await addPhoto(ctx, project.id);
    await addDocument(ctx, project.id);

    expect(sendPush).toHaveBeenNthCalledWith(1, [
      {
        to: TOKEN,
        title: "Nuevas fotos de tu obra",
        body: "Tu equipo de ViTAH ha compartido fotos nuevas.",
        data: { screen: "photos" },
      },
    ]);
    expect(sendPush).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ title: "Nuevo documento", body: "«Planos» ya está en la app." }),
    ]);
  });

  it("sends one push for a batch of photos, not one per photo", async () => {
    const { project, ctx } = await setup();

    await addPhoto(ctx, project.id);
    await addPhoto(ctx, project.id);
    await addPhoto(ctx, project.id);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("pushes again once the last photo pushed is over 10 minutes old", async () => {
    const { tenant, project, ctx } = await setup();
    await createTestPhoto(tenant.id, project.id, {
      clientNotifiedAt: new Date(Date.now() - 11 * 60 * 1000),
    });
    // Uploaded just now but hidden: the client wasn't told of it.
    await createTestPhoto(tenant.id, project.id, { visibleToClient: false });

    await addPhoto(ctx, project.id);

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("pushes a hidden document or photo when it is first shown", async () => {
    const { tenant, project, ctx } = await setup();
    const doc = await createTestDocument(tenant.id, project.id, { title: "Planos", visibleToClient: false });
    const photo = await createTestPhoto(tenant.id, project.id, { visibleToClient: false });

    await documentsService.setDocumentVisibility(ctx, project.id, doc.id, { visibleToClient: true });
    await photosService.setPhotoVisibility(ctx, project.id, photo.id, { visibleToClient: true });

    expect(sendPush).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ title: "Nuevo documento", body: "«Planos» ya está en la app." }),
    ]);
    expect(sendPush).toHaveBeenNthCalledWith(2, [expect.objectContaining({ title: "Nuevas fotos de tu obra" })]);
  });

  it("pushes a document or photo once only, however often it is hidden and shown", async () => {
    const { project, ctx } = await setup();
    const { documentId } = await addDocument(ctx, project.id);
    const { photoId } = await addPhoto(ctx, project.id);
    vi.mocked(sendPush).mockClear();

    for (const visibleToClient of [true, false, true]) {
      await documentsService.setDocumentVisibility(ctx, project.id, documentId, { visibleToClient });
      await photosService.setPhotoVisibility(ctx, project.id, photoId, { visibleToClient });
    }

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("sends one push for a batch of photos shown together", async () => {
    const { tenant, project, ctx } = await setup();
    const hidden = await Promise.all(
      [1, 2, 3].map(() => createTestPhoto(tenant.id, project.id, { visibleToClient: false })),
    );

    for (const photo of hidden) {
      await photosService.setPhotoVisibility(ctx, project.id, photo.id, { visibleToClient: true });
    }

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("pushes nothing when a document or photo is hidden", async () => {
    const { tenant, project, ctx } = await setup();
    const doc = await createTestDocument(tenant.id, project.id);
    const photo = await createTestPhoto(tenant.id, project.id);

    await documentsService.setDocumentVisibility(ctx, project.id, doc.id, { visibleToClient: false });
    await photosService.setPhotoVisibility(ctx, project.id, photo.id, { visibleToClient: false });

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("writes to each phone in its own language", async () => {
    const { tenant, client, project, ctx } = await setup();
    const english = "ExponentPushToken[phone-2]";
    await clientAccountService.registerPushToken(tenant.id, client.id, {
      token: english,
      language: "en",
    });

    await addDocument(ctx, project.id);

    expect(vi.mocked(sendPush).mock.calls[0]![0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: TOKEN, title: "Nuevo documento" }),
        expect.objectContaining({
          to: english,
          title: "New document",
          body: "“Planos” is now in the app.",
        }),
      ]),
    );
  });

  it("respects the client's toggles", async () => {
    const { tenant, client, project, ctx } = await setup();
    await clientAccountService.updateSettings(tenant.id, client.id, {
      notifications: { progress: false },
    });

    await addPhoto(ctx, project.id);
    expect(sendPush).not.toHaveBeenCalled();

    await addDocument(ctx, project.id);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a project without a client, or a client without phones", async () => {
    const { tenant, ctx } = await setup();
    const noClient = await createTestProject(tenant.id);
    const noPhone = await createTestUser(tenant.id, { role: "client" });
    const project = await createTestProject(tenant.id, { clientUserId: noPhone.id });

    await addPhoto(ctx, noClient.id);
    await addPhoto(ctx, project.id);

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("never reaches another tenant's client", async () => {
    const { project } = await setup();
    const other = await setup();

    await addPhoto(other.ctx, other.project.id);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendPush).mock.calls[0]![0]).toHaveLength(1);
    // The first client's project got nothing.
    await expect(addPhoto(other.ctx, project.id)).rejects.toMatchObject({
      code: "project_not_found",
    });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("forgets phones Expo no longer knows", async () => {
    const { project, ctx } = await setup();
    vi.mocked(sendPush).mockResolvedValue([TOKEN]);

    await addPhoto(ctx, project.id);

    expect(await db.select().from(pushTokens)).toEqual([]);
  });

  it("never fails the upload when sending fails", async () => {
    const { project, ctx } = await setup();
    vi.mocked(sendPush).mockRejectedValue(new Error("Expo is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(addPhoto(ctx, project.id)).resolves.toHaveProperty("photoId");
  });
});
