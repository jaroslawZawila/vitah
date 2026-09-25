import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pushTokens } from "@repo/db";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { clientAccountService, documentsService, photosService, type Ctx } from "../src";
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

  it("pushes again once the last photo is over 10 minutes old", async () => {
    const { tenant, project, ctx } = await setup();
    await createTestPhoto(tenant.id, project.id, {
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    await addPhoto(ctx, project.id);

    expect(sendPush).toHaveBeenCalledTimes(1);
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
