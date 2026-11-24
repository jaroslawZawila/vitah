import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetExclusionPresets, budgetRevisions, db, eq } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetExclusionsService as library,
  budgetService as svc,
  exclusionChecklist,
  MAX_EXCLUSION_PRESETS,
  withExclusion,
  type Ctx,
} from "../src";
import { DEFAULT_EXCLUSIONS } from "../src/budget-template";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  return { tenant, ctx };
}

const as = async (tenantId: string, role: Ctx["role"]): Promise<Ctx> => ({ tenantId, userId: (await createTestUser(tenantId, { role })).id, role });
const labels = async (ctx: Ctx) => (await library.listExclusionPresets(ctx)).map((p) => p.label);
const exclusionsOf = async (ctx: Ctx, projectId: string) => (await svc.getBudget(ctx, projectId)).revision!.texts.exclusions;

beforeEach(resetDatabase);

describe("the library of exclusions", () => {
  it("starts from the template's lines, once, for any staff role", async () => {
    const { tenant } = await setup();
    const viewer = await as(tenant.id, "viewer");

    expect(await labels(viewer)).toEqual(DEFAULT_EXCLUSIONS);
    expect(await labels(viewer)).toEqual(DEFAULT_EXCLUSIONS);
    expect(await db.$count(budgetExclusionPresets, eq(budgetExclusionPresets.tenantId, tenant.id))).toBe(DEFAULT_EXCLUSIONS.length);
  });

  it("adds a line last, trimmed, and gives back the one already there for the same text", async () => {
    const { ctx } = await setup();

    const added = await library.createExclusionPreset(ctx, { label: "  Piscina y su equipamiento. " });
    const again = await library.createExclusionPreset(ctx, { label: "Piscina y su equipamiento." });

    expect(added).toEqual({ id: expect.any(String), label: "Piscina y su equipamiento." });
    expect(again.id).toBe(added.id);
    expect(await labels(ctx)).toEqual([...DEFAULT_EXCLUSIONS, "Piscina y su equipamiento."]);
  });

  it("edits a line, refusing the text of another one; a budget keeps what it ticked", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    await framerDraft(ctx, project.id, []);
    const [first, second] = await library.listExclusionPresets(ctx);

    await expect(library.updateExclusionPreset(ctx, first!.id, { label: second!.label })).rejects.toMatchObject({ code: "exclusion_exists", status: 409 });
    const edited = await library.updateExclusionPreset(ctx, first!.id, { label: "Estudio geotécnico." });

    expect(edited).toEqual({ id: first!.id, label: "Estudio geotécnico." });
    expect((await labels(ctx))[0]).toBe("Estudio geotécnico.");
    // The draft had the template's text: it still does, now as one of its own lines.
    const exclusions = await exclusionsOf(ctx, project.id);
    expect(exclusions[0]).toBe(first!.label);
    expect(exclusionChecklist(exclusions, await library.listExclusionPresets(ctx)).extra).toEqual([first!.label]);
  });

  it("deletes a line softly: gone from the library, kept as a row, never written again from the template", async () => {
    const { tenant, ctx } = await setup();
    const presets = await library.listExclusionPresets(ctx);

    for (const preset of presets) await library.deleteExclusionPreset(ctx, preset.id);

    expect(await labels(ctx)).toEqual([]);
    const rows = await db.select().from(budgetExclusionPresets).where(eq(budgetExclusionPresets.tenantId, tenant.id));
    expect(rows).toHaveLength(presets.length);
    expect(rows.every((r) => r.deletedAt !== null && r.deletedById === ctx.userId)).toBe(true);
    await expect(library.deleteExclusionPreset(ctx, presets[0]!.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(library.updateExclusionPreset(ctx, presets[0]!.id, { label: "x" })).rejects.toMatchObject({ code: "not_found" });
    // The same text again is a new line.
    const back = await library.createExclusionPreset(ctx, { label: presets[0]!.label });
    expect(back.id).not.toBe(presets[0]!.id);
    expect(await labels(ctx)).toEqual([presets[0]!.label]);
  });

  it("holds MAX_EXCLUSION_PRESETS lines at most", async () => {
    const { ctx } = await setup();
    const room = MAX_EXCLUSION_PRESETS - DEFAULT_EXCLUSIONS.length;
    for (let i = 0; i < room; i++) await library.createExclusionPreset(ctx, { label: `Línea ${i}` });

    await expect(library.createExclusionPreset(ctx, { label: "Una más" })).rejects.toMatchObject({ code: "exclusion_library_full", status: 409 });
    // One already there is no new line.
    expect((await library.createExclusionPreset(ctx, { label: "Línea 0" })).label).toBe("Línea 0");
  });

  it("refuses a blank or too long line", async () => {
    const { ctx } = await setup();
    await expect(library.createExclusionPreset(ctx, { label: "  " })).rejects.toMatchObject({ code: "missing_fields", status: 400 });
    await expect(library.createExclusionPreset(ctx, {})).rejects.toMatchObject({ code: "missing_fields" });
    await expect(library.createExclusionPreset(ctx, { label: "x".repeat(2_001) })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("is written by admins and managers only", async () => {
    const { tenant, ctx } = await setup("admin");
    const viewer = await as(tenant.id, "viewer");
    const [preset] = await library.listExclusionPresets(ctx);

    await expect(library.createExclusionPreset(viewer, { label: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(library.updateExclusionPreset(viewer, preset!.id, { label: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(library.deleteExclusionPreset(viewer, preset!.id)).rejects.toMatchObject({ status: 403 });
    expect(await library.createExclusionPreset(ctx, { label: "De un admin" })).toMatchObject({ label: "De un admin" });
  });

  it("is the tenant's own", async () => {
    const { ctx } = await setup();
    const { ctx: other } = await setup();
    await library.createExclusionPreset(ctx, { label: "Solo de A" });
    const [preset] = await library.listExclusionPresets(ctx);

    expect(await labels(other)).toEqual(DEFAULT_EXCLUSIONS);
    await expect(library.updateExclusionPreset(other, preset!.id, { label: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(library.deleteExclusionPreset(other, preset!.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await labels(ctx))[0]).toBe(preset!.label);
  });
});

describe("a draft's exclusions as a checklist", () => {
  async function draft() {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);
    const { revisionId } = await framerDraft(ctx, project.id, []);
    const tick = (text: string, included: boolean, save?: boolean) =>
      svc.updateRevision(ctx, project.id, revisionId, { exclusion: { text, included, ...(save === undefined ? {} : { save }) } });
    return { tenant, ctx, project, revisionId, tick };
  }

  it("unticks and ticks a library line back into its place", async () => {
    const { ctx, project, tick } = await draft();
    const [, second] = DEFAULT_EXCLUSIONS;

    await tick(second!, false);
    expect(await exclusionsOf(ctx, project.id)).toEqual(DEFAULT_EXCLUSIONS.filter((l) => l !== second));
    await tick(second!, true);
    expect(await exclusionsOf(ctx, project.id)).toEqual(DEFAULT_EXCLUSIONS);
    // Ticked twice: once.
    await tick(second!, true);
    expect(await exclusionsOf(ctx, project.id)).toEqual(DEFAULT_EXCLUSIONS);
  });

  it("adds a line of its own last; with `save` it joins the library, and the library's lines", async () => {
    const { ctx, project, tick } = await draft();

    await tick("  Solo para esta obra ", true);
    await tick("Piscina", true, true);

    expect(await exclusionsOf(ctx, project.id)).toEqual([...DEFAULT_EXCLUSIONS, "Piscina", "Solo para esta obra"]);
    expect(await labels(ctx)).toEqual([...DEFAULT_EXCLUSIONS, "Piscina"]);
    // Removing it from the budget leaves the library alone.
    await tick("Piscina", false);
    expect(await exclusionsOf(ctx, project.id)).toEqual([...DEFAULT_EXCLUSIONS, "Solo para esta obra"]);
    expect(await labels(ctx)).toContain("Piscina");
  });

  it("puts an edited line in the place of the one it replaces", async () => {
    const { ctx, project, revisionId } = await draft();
    const [first, second] = DEFAULT_EXCLUSIONS;
    const replace = (text: string, replaces: string) => svc.updateRevision(ctx, project.id, revisionId, { exclusion: { text, included: true, replaces } });

    await replace("Estudio geotécnico", first!);
    expect((await exclusionsOf(ctx, project.id)).slice(0, 2)).toEqual(["Estudio geotécnico", second]);
    // Onto a line it already has: once.
    await replace(second!, "Estudio geotécnico");
    expect(await exclusionsOf(ctx, project.id)).toEqual(DEFAULT_EXCLUSIONS.slice(1));
    // A line it no longer has: ticked as any other.
    await replace(first!, "Ya no está");
    expect(await exclusionsOf(ctx, project.id)).toEqual(DEFAULT_EXCLUSIONS);
  });

  it("keeps every tick sent at once", async () => {
    const { ctx, project, tick } = await draft();
    await Promise.all(DEFAULT_EXCLUSIONS.map((line) => tick(line, false)));
    expect(await exclusionsOf(ctx, project.id)).toEqual([]);
    await Promise.all(DEFAULT_EXCLUSIONS.slice(0, 4).map((line) => tick(line, true)));
    expect(await exclusionsOf(ctx, project.id)).toEqual(DEFAULT_EXCLUSIONS.slice(0, 4));
  });

  it("is refused on an issued revision, to a viewer and on another tenant's project, before anything is saved", async () => {
    const { tenant, ctx, project, revisionId, tick } = await draft();
    const viewer = await as(tenant.id, "viewer");
    const { ctx: stranger } = await setup();
    const body = { exclusion: { text: "Nueva", included: true, save: true } };

    await expect(svc.updateRevision(viewer, project.id, revisionId, body)).rejects.toMatchObject({ status: 403 });
    await expect(svc.updateRevision(stranger, project.id, revisionId, body)).rejects.toMatchObject({ status: 404 });
    await expect(tick("", true)).rejects.toMatchObject({ code: "missing_fields", status: 400 });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { exclusion: { text: "x", included: "yes" } })).rejects.toMatchObject({ code: "invalid_input" });
    await db.update(budgetRevisions).set({ status: "issued" }).where(eq(budgetRevisions.id, revisionId));
    await expect(tick("Nueva", true, true)).rejects.toMatchObject({ code: "not_draft", status: 409 });
    expect(await labels(ctx)).not.toContain("Nueva");
  });

  it("holds 50 lines at most", async () => {
    const { ctx, project, revisionId, tick } = await draft();
    await svc.updateRevision(ctx, project.id, revisionId, { texts: { exclusions: Array.from({ length: 50 }, (_, i) => `L${i}`) } });
    await expect(tick("Una más", true)).rejects.toMatchObject({ code: "too_many_exclusions", status: 409 });
  });

  it("is a FRAMER budget's: an older model's draft is refused", async () => {
    const { revisionId, tick } = await draft();
    await db.update(budgetRevisions).set({ model: null }).where(eq(budgetRevisions.id, revisionId));
    await expect(tick("Una más", true)).rejects.toMatchObject({ code: "invalid_state", status: 409 });
  });
});

describe("withExclusion and exclusionChecklist", () => {
  const library = ["A", "B", "C", "D"];

  it("puts a library line among the ticked ones in the library's order, ahead of the budget's own", () => {
    expect(withExclusion(["A", "D", "x"], "C", true, library)).toEqual(["A", "C", "D", "x"]);
    expect(withExclusion(["x", "A"], "B", true, library)).toEqual(["x", "A", "B"]);
    expect(withExclusion(["A", "x"], "D", true, library)).toEqual(["A", "D", "x"]);
    // After the last one before it, even past a line of the budget's own.
    expect(withExclusion(["A", "x", "B"], "C", true, library)).toEqual(["A", "x", "B", "C"]);
    expect(withExclusion(["x", "C"], "A", true, library)).toEqual(["x", "A", "C"]);
    expect(withExclusion(["x", "y"], "A", true, library)).toEqual(["A", "x", "y"]);
    expect(withExclusion(["A", "B"], "y", true, library)).toEqual(["A", "B", "y"]);
    expect(withExclusion(["A", "x", "B"], "x", false, library)).toEqual(["A", "B"]);
    expect(withExclusion(["A", "x", "B"], "y", true, library, "x")).toEqual(["A", "y", "B"]);
    expect(withExclusion(["A", "x", "B"], "B", true, library, "x")).toEqual(["A", "B"]);
  });

  it("splits a budget's lines into the library's, ticked or not, and its own", () => {
    const presets = library.map((label) => ({ id: label, label }));
    expect(exclusionChecklist(["B", "own", "D"], presets)).toEqual({
      library: presets.map((preset) => ({ preset, included: preset.label === "B" || preset.label === "D" })),
      extra: ["own"],
    });
  });
});
