import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetService,
  purchaseAmendmentsService as svc,
  purchaseInvoicesService,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (content = "%PDF-1.7 modificado") => new File([content], "Modificado.pdf", { type: "application/pdf" });

/**
 * A project with an accepted budget of chapters 01–03 (one line of 1.000 € at
 * cost each) and a subcontract of 01 (800 €) and 02 (400 €), contracted.
 */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const user = await createTestUser(tenant.id, { role, name: "Laura Pérez" });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const project = await createTestProject(tenant.id);
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId);
  const { id: subcontractorId } = await subcontractorsService.createSubcontractor(admin, {
    kind: "company",
    legalName: "Montajes Steel Norte S.L.",
    taxId: "B39123450",
    address: "Polígono Raos 4",
    postalCode: "39600",
    city: "Maliaño",
  });
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  const { orderId } = await purchasingService.createPurchase(admin, project.id, {
    kind: "subcontract",
    subcontractorId,
    description: "Estructura",
    status: "contracted",
    orderedOn: "2026-09-01",
    lines: [
      { lineageId: lineage("01"), amountCents: 80_000 },
      { lineageId: lineage("02"), amountCents: 40_000, closesLine: false },
    ],
  });
  return { tenant, admin, ctx, project, subcontractorId, lineage, orderId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** 01 up to 870 €, 02 as it was, 03 added for 150 €. */
const amendment = (s: Setup, overrides: Record<string, unknown> = {}) => ({
  concept: "Refuerzo de forjado por cambio de uso",
  signedOn: "2026-10-12",
  lines: [
    { lineageId: s.lineage("01"), amountCents: 87_000 },
    { lineageId: s.lineage("02"), amountCents: 40_000, closesLine: false },
    { lineageId: s.lineage("03"), amountCents: 15_000 },
  ],
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("an order's modificados", () => {
  it("numbers each one, changes the order's lines and keeps the original amount and every change", async () => {
    const s = await setup();
    const first = await svc.amendPurchase(s.ctx, s.orderId, amendment(s));
    expect(first).toEqual({ amendmentId: expect.any(String), number: 1, deltaCents: 22_000 });
    const second = await svc.amendPurchase(s.ctx, s.orderId, {
      concept: "Se elimina la partida 03",
      lines: [
        { lineageId: s.lineage("01"), amountCents: 87_000 },
        { lineageId: s.lineage("02"), amountCents: 40_000, closesLine: false },
      ],
    });
    expect(second).toMatchObject({ number: 2, deltaCents: -15_000 });

    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order.amountCents).toBe(127_000);
    expect(order.originalAmountCents).toBe(120_000);
    // A correction by edit since stays part of the original: the modificados explain only their own change.
    await purchasingService.updatePurchase(s.ctx, s.orderId, {
      lines: [
        { lineageId: s.lineage("01"), amountCents: 87_000 },
        { lineageId: s.lineage("02"), amountCents: 41_000, closesLine: false },
      ],
    });
    expect(await purchasingService.getPurchase(s.ctx, s.orderId)).toMatchObject({ amountCents: 128_000, originalAmountCents: 121_000 });
    expect(order.amendments.map((a) => [a.number, a.signedOn, a.amountBeforeCents, a.amountAfterCents, a.by])).toEqual([
      [2, "2026-10-19", 142_000, 127_000, "Laura Pérez"],
      [1, "2026-10-12", 120_000, 142_000, "Laura Pérez"],
    ]);
    expect(order.amendments[1]!.changes).toEqual([
      { code: expect.stringMatching(/^01\./), lineageId: s.lineage("01"), from: { amountCents: 80_000, closesLine: true }, to: { amountCents: 87_000, closesLine: true } },
      { code: expect.stringMatching(/^03\./), lineageId: s.lineage("03"), from: null, to: { amountCents: 15_000, closesLine: true } },
    ]);
    expect(order.events[0]).toMatchObject({ action: "amended", detail: { number: 2, deltaCents: -15_000 } });
    // What it contracts follows: line 01 is now 870 €, a 130 € saving.
    const line01 = order.lines.find((l) => l.lineageId === s.lineage("01"))!;
    expect(line01).toMatchObject({ amountCents: 87_000, deviationCents: -13_000 });
  });

  it("stores its signed PDF as one of the order's documents", async () => {
    const s = await setup();
    // The title's {n} is the number core gives it; without a title, the file's name.
    const { amendmentId } = await svc.amendPurchase(s.ctx, s.orderId, { ...amendment(s), file: pdf(), documentTitle: "Modificado nº {n} firmado" });
    await svc.amendPurchase(s.ctx, s.orderId, { ...amendment(s, { concept: "Segundo", lines: amendment(s).lines.slice(0, 2) }), file: pdf() });
    const order = await purchasingService.getPurchase(s.ctx, s.orderId);
    expect(order.documents.map((d) => d.title)).toEqual(["Modificado nº 1 firmado", "Modificado"]);
    expect(order.amendments[1]).toMatchObject({ id: amendmentId, document: { id: order.documents[0]!.id, title: "Modificado nº 1 firmado" } });
    // A bad file stops it before anything changes.
    await expect(svc.amendPurchase(s.ctx, s.orderId, { ...amendment(s, { concept: "Otro" }), file: new File(["no"], "x.pdf") })).rejects.toMatchObject({
      code: "invalid_file_type",
    });
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).amendments).toHaveLength(2);
  });

  it("keeps the payment schedule adding up: a rise is a milestone of its own, a cut comes off those not invoiced", async () => {
    const s = await setup();
    await purchaseInvoicesService.setOrderMilestones(s.admin, s.orderId, {
      milestones: [
        { concept: "Fabricación", amountCents: 60_000 },
        { concept: "Montaje", amountCents: 60_000 },
      ],
    });
    const [first] = (await purchasingService.getPurchase(s.ctx, s.orderId)).milestones;
    await purchaseInvoicesService.createInvoice(s.admin, s.orderId, { number: "MSN-1", issuedOn: "2026-10-01", baseCents: 60_000, milestoneId: first!.id });

    await svc.amendPurchase(s.ctx, s.orderId, amendment(s));
    let schedule = (await purchasingService.getPurchase(s.ctx, s.orderId)).milestones;
    expect(schedule.map((m) => [m.concept, m.amountCents])).toEqual([
      ["Fabricación", 60_000],
      ["Montaje", 60_000],
      ["Refuerzo de forjado por cambio de uso", 22_000],
    ]);
    // 650 € off: the new 220 € milestone goes, and 430 € come off Montaje; Fabricación is invoiced.
    await svc.amendPurchase(s.ctx, s.orderId, {
      concept: "Recorte",
      lines: [
        { lineageId: s.lineage("01"), amountCents: 46_000 },
        { lineageId: s.lineage("02"), amountCents: 31_000, closesLine: false },
      ],
    });
    schedule = (await purchasingService.getPurchase(s.ctx, s.orderId)).milestones;
    expect(schedule.map((m) => [m.concept, m.amountCents])).toEqual([
      ["Fabricación", 60_000],
      ["Montaje", 17_000],
    ]);
    // Down to what was invoiced: the last milestone not invoiced goes.
    await svc.amendPurchase(s.ctx, s.orderId, {
      concept: "Fin del contrato",
      lines: [
        { lineageId: s.lineage("01"), amountCents: 40_000 },
        { lineageId: s.lineage("02"), amountCents: 20_000, closesLine: false },
      ],
    });
    schedule = (await purchasingService.getPurchase(s.ctx, s.orderId)).milestones;
    expect(schedule.map((m) => [m.concept, m.amountCents])).toEqual([["Fabricación", 60_000]]);
  });

  it("is only for a placed order, needs a reason and a change, and keeps the lines its invoices are split across", async () => {
    const s = await setup();
    const reject = (input: Record<string, unknown>) => svc.amendPurchase(s.ctx, s.orderId, { ...amendment(s), ...input });
    await expect(reject({ concept: " " })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(reject({ signedOn: "2026-10-20" })).rejects.toMatchObject({ code: "invalid_date" });
    // Not before the order was placed (1 Sep).
    await expect(reject({ signedOn: "2026-08-31" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(
      reject({ lines: [{ lineageId: s.lineage("01"), amountCents: 80_000 }, { lineageId: s.lineage("02"), amountCents: 40_000, closesLine: false }] }),
    ).rejects.toMatchObject({ code: "no_changes" });

    // Invoiced 400 €, in proportion: 266,67 € on 01 and 133,33 € on 02.
    await purchaseInvoicesService.createInvoice(s.admin, s.orderId, { number: "MSN-1", issuedOn: "2026-10-01", baseCents: 40_000 });
    await expect(reject({ lines: [{ lineageId: s.lineage("03"), amountCents: 120_000 }] })).rejects.toMatchObject({ code: "has_invoices" });
    await expect(
      reject({ lines: [{ lineageId: s.lineage("01"), amountCents: 20_000 }, { lineageId: s.lineage("02"), amountCents: 40_000, closesLine: false }] }),
    ).rejects.toMatchObject({ code: "below_invoiced" });

    const pending = await purchasingService.createPurchase(s.admin, s.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Sin contratar",
      lines: [{ lineageId: s.lineage("03"), amountCents: 10_000 }],
    });
    await expect(svc.amendPurchase(s.ctx, pending.orderId, amendment(s))).rejects.toMatchObject({ code: "invalid_state" });
    expect((await purchasingService.getPurchase(s.ctx, s.orderId)).amendments).toEqual([]);
  });

  it("is written by admins and managers of the order's tenant only", async () => {
    const s = await setup("viewer");
    await expect(svc.amendPurchase(s.ctx, s.orderId, amendment(s))).rejects.toMatchObject({ code: "forbidden" });
    const other = await setup();
    await expect(svc.amendPurchase(other.ctx, s.orderId, amendment(s))).rejects.toMatchObject({ code: "not_found" });
  });
});
