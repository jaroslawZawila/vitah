import { beforeAll, describe, expect, it, vi } from "vitest";
import { db, sql } from "@repo/db";
import { resetDatabase } from "@repo/db/testing";
import {
  constructionService,
  purchaseInvoicesService,
  purchaseRequestsService,
  purchasingService,
  subcontractorsService,
  subcontractorWorkersService,
  budgetOverviewService,
  type Ctx,
} from "../src";
import { assertVolumeTarget, seedVolume, VOLUME_SLUGS } from "../src/seed/volume";

vi.mock("../src/storage", () => import("../src/testing"));

describe("assertVolumeTarget", () => {
  it("only lets the volume seed fill a local database of its own", () => {
    expect(() => assertVolumeTarget("postgres://vitah:vitah_dev@localhost:4432/vitah_volume")).not.toThrow();
    expect(() => assertVolumeTarget("postgres://vitah:vitah_dev@127.0.0.1:4432/vitah_core_test_ab12cd34")).not.toThrow();
    // Never the dev database, a remote one, or none.
    expect(() => assertVolumeTarget("postgres://vitah:vitah_dev@localhost:4432/vitah")).toThrow(/of its own/);
    expect(() => assertVolumeTarget("postgres://vitah:vitah_dev@localhost:4432/")).toThrow(/of its own/);
    expect(() => assertVolumeTarget("postgres://user:secret@db.example.com:5432/vitah_volume")).toThrow(/local database/);
    expect(() => assertVolumeTarget("postgres://user:secret@localhost.example.com/vitah_volume")).toThrow(/local database/);
    expect(() => assertVolumeTarget("postgres://user:secret@10.0.0.5/vitah_volume")).toThrow(/local database/);
    expect(() => assertVolumeTarget(undefined)).toThrow(/POSTGRES_URL/);
  });
});

// A smoke test on a small fraction of the dataset: the services read what the seed inserts in bulk.
describe("seedVolume", () => {
  let seeded: Awaited<ReturnType<typeof seedVolume>>;
  let ctx: Ctx;
  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedVolume({ scale: 0.04 });
    ctx = { tenantId: seeded.big.tenantId, userId: seeded.big.adminId, role: "admin" };
  }, 120_000);

  it("fills two tenants the services can read", async () => {
    const { counts } = seeded.big;
    expect(counts).toMatchObject({ projects: 2, started: 2, budgets: 2, companies: 6 });
    expect(counts.orders).toBeGreaterThan(20);
    expect(counts.invoices).toBeGreaterThan(10);
    expect(counts.payments).toBeGreaterThan(5);

    const purchases = await purchasingService.listPurchases(ctx, { page: 1, limit: 10 });
    expect(purchases.paging.total).toBe(counts.orders);
    expect(purchases.orders).toHaveLength(10);
    expect(purchases.summary.openOrders + purchases.summary.pendingOrders).toBeGreaterThan(0);
    const invoices = await purchaseInvoicesService.listInvoices(ctx, {}, { page: 1 });
    expect(invoices.paging.total).toBe(counts.invoices);
    expect((await purchaseInvoicesService.listPayments(ctx, {}, { page: 1 })).paging.total).toBe(counts.payments);
    expect((await purchaseRequestsService.listRequests(ctx)).requests).toHaveLength(counts.requests);
    expect(await purchaseInvoicesService.getPurchasingCounts(ctx)).toMatchObject({ orders: counts.orders, invoices: counts.invoices, payments: counts.payments, suppliers: counts.companies });

    const overview = await subcontractorsService.getOverview(ctx);
    expect(overview.companies).toHaveLength(counts.companies);
    expect(overview.workers.total).toBe(counts.workers);
    expect((await subcontractorWorkersService.listWorkersPage(ctx, { page: 1 })).summary.registered).toBe(counts.workers);
    expect((await budgetOverviewService.listBudgets(ctx)).summary.accepted).toBe(2);

    // An obra under way: its Obra tab and its Compras by budget line add up from the bulk rows.
    const [project] = (await purchasingService.listPurchases(ctx, { page: 1, limit: 1, group: "done" })).orders;
    const control = await constructionService.getControl(ctx, project!.projectId);
    expect(control.chapters.some((c) => c.actualStart !== null)).toBe(true);
    expect(control.cost.contractedCents).toBeGreaterThan(0);
    const lines = await purchasingService.getProjectPurchaseLines(ctx, project!.projectId);
    expect(lines.counts.contracted + lines.counts.invoiced + lines.counts.paid).toBeGreaterThan(0);
  });

  it("keeps what it inserts in bulk as the services would have written it", async () => {
    const [checks] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*) from purchase_invoices i where i.base_cents <>
          (select coalesce(sum(l.amount_cents), 0) from purchase_invoice_lines l where l.invoice_id = i.id))::int as unsplit_invoices,
        (select count(*) from purchase_invoices i join purchase_orders o on o.id = i.order_id
          where o.status in ('pending', 'cancelled') or i.subcontractor_id <> o.subcontractor_id or i.issued_on > current_date)::int as misplaced_invoices,
        (select count(*) from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id
          where not exists (select 1 from purchase_order_lines ol where ol.order_id = i.order_id and ol.lineage_id = l.lineage_id))::int as stray_invoice_lines,
        (select count(*) from (
          select i.id from purchase_invoices i left join purchase_payments p on p.invoice_id = i.id
          where i.kind = 'invoice' group by i.id, i.base_cents, i.vat_cents, i.irpf_cents
          having coalesce(sum(p.amount_cents), 0) > i.base_cents + i.vat_cents - i.irpf_cents) over_paid)::int as overpaid_invoices,
        (select count(*) from purchase_orders o where (o.status in ('delivered', 'finished')) <> (o.completed_on is not null)
          or (o.status not in ('pending', 'cancelled') and o.ordered_on is null) or o.ordered_on > current_date)::int as misdated_orders,
        (select count(*) from purchase_order_lines l join purchase_orders o on o.id = l.order_id
          where not exists (
            select 1 from budget_lines b join budget_chapters c on c.id = b.chapter_id join budget_revisions r on r.id = c.revision_id
            where b.lineage_id = l.lineage_id and r.project_id = o.project_id and r.status = 'accepted'))::int as stray_order_lines,
        (select count(*) from purchase_orders o join subcontractors s on s.id = o.subcontractor_id
          where o.kind = 'subcontract' and s.supplies_only)::int as subcontracts_to_suppliers,
        (select count(*) from (
          select o.id from purchase_order_milestones m join purchase_orders o on o.id = m.order_id group by o.id
          having sum(m.amount_cents) <> (select sum(l.amount_cents) from purchase_order_lines l where l.order_id = o.id)) off_schedule)::int as unbalanced_schedules,
        (select count(*) from subcontractor_documents d join subcontractors s on s.id = d.subcontractor_id where s.supplies_only)::int as supplier_documents,
        (select count(*) from subcontractor_workers w join subcontractors s on s.id = w.subcontractor_id where s.supplies_only or w.tenant_id <> s.tenant_id)::int as stray_workers,
        (select count(*) from purchase_orders o join projects p on p.id = o.project_id join subcontractors s on s.id = o.subcontractor_id
          where o.tenant_id <> p.tenant_id or o.tenant_id <> s.tenant_id)::int as cross_tenant_orders`);
    expect(checks).toEqual({
      unsplit_invoices: 0,
      misplaced_invoices: 0,
      stray_invoice_lines: 0,
      overpaid_invoices: 0,
      misdated_orders: 0,
      stray_order_lines: 0,
      subcontracts_to_suppliers: 0,
      unbalanced_schedules: 0,
      supplier_documents: 0,
      stray_workers: 0,
      cross_tenant_orders: 0,
    });
  });

  it("keeps its two tenants apart, and makes the same data again when it runs again", async () => {
    const small: Ctx = { tenantId: seeded.small.tenantId, userId: seeded.small.adminId, role: "admin" };
    expect((await purchasingService.listPurchases(small, { page: 1 })).paging.total).toBe(seeded.small.counts.orders);
    expect((await subcontractorsService.listSubcontractors(small)).length).toBe(seeded.small.counts.companies);

    const again = await seedVolume({ scale: 0.04 });
    expect(again.big.counts).toEqual(seeded.big.counts);
    expect(again.small.counts).toEqual(seeded.small.counts);
    expect(again.big.tenantId).toBe(seeded.big.tenantId);
    // The first run's rows are gone: its tenants were replaced, not doubled.
    const slugs = await db.execute<{ slug: string }>(sql`select slug from tenants order by slug`);
    expect(slugs.map((row) => row.slug)).toEqual(Object.values(VOLUME_SLUGS).sort());
    await expect(seedVolume({ scale: 0 })).rejects.toThrow(/scale/);
  }, 120_000);
});
