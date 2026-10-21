import { aiUsage, and, db, eq, gt, sql, tenants } from "@repo/db";

// The tenant's monthly AI spend against its limit (`tenants.ai_monthly_limit_cents`,
// null = none): the budget's AI draft and the purchase documents' review both stop at it.

/** This month's AI spend of the tenant, in US cents. */
export async function monthSpendCents(tenantId: string) {
  const [row] = await db
    .select({ micro: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), gt(aiUsage.createdAt, sql`date_trunc('month', now())`)));
  return Number(row?.micro ?? 0) / 10_000;
}

/** Whether the tenant has spent its monthly AI limit. */
export async function aiLimitReached(tenantId: string) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { aiMonthlyLimitCents: true } });
  return tenant?.aiMonthlyLimitCents != null && (await monthSpendCents(tenantId)) >= tenant.aiMonthlyLimitCents;
}
