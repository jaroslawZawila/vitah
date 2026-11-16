"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { companyType, type PurchaseSupplierItem, type TenantSuppliers } from "@repo/core/contract";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Dash } from "../../projects/[id]/components/construction/SummaryTable";
import Kpi from "../../projects/[id]/components/obra/Kpi";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { supplierHref } from "../../projects/[id]/components/purchasing/links";
import { SupplierCaePill } from "../../projects/[id]/components/purchasing/pills";
import { stretchedLink, touchLink } from "../../components/touch";
import { useVatLabel } from "../../components/vat-basis";

// Presentational: Compras › Proveedores, every company as a supplier, and one
// supplier's figures. The containers (SuppliersScreen, SupplierScreen) filter.

/** "Proveedor de material", "Empresa", "Autónomo". */
function useSupplierType() {
  const ty = useTranslations("subcontractors.fields.types");
  return (s: Pick<PurchaseSupplierItem, "kind" | "suppliesOnly">) => ty(`${companyType(s)}.label`);
}

/** What the company contracted, owes and holds back, across its suppliers. */
export function SuppliersKpis({ summary }: { summary: TenantSuppliers["summary"] }) {
  const t = useTranslations("purchasing.suppliers.kpis");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  const overdue = summary.overdueCents > 0;
  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Kpi label={vat(t("contracted"), "excl")} value={f.money(summary.contractedCents)} hints={[t("active", { count: summary.active })]} />
      <Kpi label={vat(t("outstanding"), "incl")} value={f.money(summary.outstandingCents)} hints={[t("outstandingHint")]} />
      <Kpi
        label={vat(t("overdue"), "incl")}
        value={<span className={cn(overdue && "text-bad")}>{f.money(summary.overdueCents)}</span>}
        className={cn(overdue && "border-bad/40")}
        hints={[overdue ? t("overdueSuppliers", { count: summary.overdueSuppliers }) : t("noneOverdue")]}
      />
      <Kpi label={vat(t("retained"), "incl")} value={f.money(summary.retainedCents)} hints={[t("retainedHint")]} />
    </section>
  );
}

/**
 * One supplier's own figures in two groups, each under its VAT basis: what is
 * compared with the cost (contracted, invoiced, paid; without VAT) and what
 * Administration pays (owed, of it past due, and held back; with VAT).
 */
export function SupplierFigures({ supplier }: { supplier: PurchaseSupplierItem }) {
  const t = useTranslations("purchasing.suppliers.kpis");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  const overdue = supplier.overdueCents > 0;
  const caption = "eyebrow font-sans";
  return (
    <section aria-label={t("label")} className="grid gap-x-3.5 gap-y-4 xl:grid-cols-[3fr_2fr]">
      <section aria-labelledby="supplier-cost-figures" className="flex min-w-0 flex-col gap-2">
        <h2 id="supplier-cost-figures" className={caption}>
          {vat(t("againstCost"), "excl")}
        </h2>
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
          <Kpi
            label={t("contracted")}
            value={f.money(supplier.contractedCents)}
            hints={[t("orders", { count: supplier.orders, projects: supplier.projects })]}
          />
          <Kpi label={t("invoiced")} value={f.money(supplier.invoicedCents)} />
          <Kpi label={t("paid")} value={f.money(supplier.paidCents)} />
        </div>
      </section>
      <section aria-labelledby="supplier-payable-figures" className="flex min-w-0 flex-col gap-2">
        <h2 id="supplier-payable-figures" className={caption}>
          {vat(t("toPay"), "incl")}
        </h2>
        <div className="grid grid-cols-2 gap-3.5">
          <Kpi
            label={t("outstanding")}
            value={<span className={cn(overdue && "text-bad")}>{f.money(supplier.outstandingCents)}</span>}
            className={cn(overdue && "border-bad/40")}
            hints={[overdue ? t("overdueOf", { amount: f.money(supplier.overdueCents) }) : t("outstandingHint")]}
          />
          <Kpi label={t("retained")} value={f.money(supplier.retainedCents)} hints={[t("retainedHint")]} />
        </div>
      </section>
    </section>
  );
}

/** Owed, and of it past due: "1.254 €" over "1.254 € vencido". */
function Owed({ supplier }: { supplier: PurchaseSupplierItem }) {
  const t = useTranslations("purchasing.suppliers.list");
  const f = usePurchaseFormat();
  if (supplier.outstandingCents === 0) return <Dash />;
  return (
    <>
      <span className="font-semibold">{f.amount(supplier.outstandingCents)}</span>
      {supplier.overdueCents > 0 && (
        <span className="block text-meta text-bad">{t("overdue", { amount: f.amount(supplier.overdueCents) })}</span>
      )}
    </>
  );
}

/** The suppliers: cards on phones, a table from 768px; each links to its page. */
export function SupplierList({ suppliers, empty }: { suppliers: PurchaseSupplierItem[]; empty: string }) {
  const t = useTranslations("purchasing.suppliers.list");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  const typeOf = useSupplierType();
  if (suppliers.length === 0) return <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const name = (supplier: PurchaseSupplierItem, className?: string) => (
    <Link href={supplierHref(supplier.id)} className={cn("font-semibold text-brand-ink hover:text-primary", className)}>
      {supplier.legalName}
    </Link>
  );
  return (
    <>
      {/* Phones: one card per supplier. */}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 px-3 pb-3 md:hidden" aria-label={t("cards")}>
        {suppliers.map((supplier) => (
          <li key={supplier.id} className="relative rounded-xl border bg-card px-4 py-3.5 shadow-card">
            <div className="flex items-start justify-between gap-2.5">
              {name(supplier, cn("min-w-0 [overflow-wrap:anywhere]", stretchedLink))}
              <SupplierCaePill suppliesOnly={supplier.suppliesOnly} status={supplier.caeStatus} />
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {typeOf(supplier)} · {t("ordersCount", { count: supplier.orders })}
            </div>
            <div className="mt-2.5 flex items-end justify-between gap-2.5 text-sm">
              <span className="num">{t("contractedShort", { amount: f.amount(supplier.contractedCents) })}</span>
              <span className="num text-right">
                <Owed supplier={supplier} />
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* From 768px: the table. */}
      <div className="hidden md:block">
        <Table className="min-w-[980px]" aria-label={t("table")}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("supplier")}</TableHead>
              <TableHead>{t("orders")}</TableHead>
              <TableHead className="text-right">{vat(t("contracted"), "excl")}</TableHead>
              <TableHead className="text-right">{vat(t("invoiced"), "excl")}</TableHead>
              <TableHead className="text-right">{vat(t("paid"), "excl")}</TableHead>
              <TableHead className="text-right">{vat(t("outstanding"), "incl")}</TableHead>
              <TableHead className="pr-[18px]">{t("lastOrder")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.map((supplier) => (
              <TableRow key={supplier.id}>
                <TableCell className="min-w-[220px] pl-[18px] whitespace-normal">
                  {name(supplier, touchLink)}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
                    {typeOf(supplier)}
                    {!supplier.suppliesOnly && supplier.caeStatus !== "apta" && (
                      <SupplierCaePill suppliesOnly={false} status={supplier.caeStatus} />
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {supplier.orders === 0 ? (
                    <Dash />
                  ) : (
                    <>
                      <span className="num">{supplier.orders}</span>
                      <span className="text-meta text-muted-foreground"> · {t("projects", { count: supplier.projects })}</span>
                    </>
                  )}
                </TableCell>
                <TableCell className="num text-right">{supplier.contractedCents ? f.amount(supplier.contractedCents) : <Dash />}</TableCell>
                <TableCell className="num text-right">{supplier.invoicedCents ? f.amount(supplier.invoicedCents) : <Dash />}</TableCell>
                <TableCell className="num text-right">{supplier.paidCents ? f.amount(supplier.paidCents) : <Dash />}</TableCell>
                <TableCell className="num text-right">
                  <Owed supplier={supplier} />
                </TableCell>
                <TableCell className="num pr-[18px] whitespace-nowrap">
                  {supplier.lastOrderOn ? f.date(supplier.lastOrderOn) : <Dash />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** The supplier's name, type and CAE, with its Subcontratas ficha. */
export function SupplierHeading({ supplier, fichaHref }: { supplier: PurchaseSupplierItem; fichaHref: string }) {
  const t = useTranslations("purchasing.suppliers.detail");
  const typeOf = useSupplierType();
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="eyebrow">{t("eyebrow")}</span>
          <SupplierCaePill suppliesOnly={supplier.suppliesOnly} status={supplier.caeStatus} />
        </div>
        <h1 className="mt-1.5 [overflow-wrap:anywhere]">{supplier.legalName}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {typeOf(supplier)} ·{" "}
          <Link href={fichaHref} className={cn("font-medium text-brand-ink hover:text-primary", touchLink)}>
            {t("ficha")}
          </Link>
        </p>
      </div>
    </header>
  );
}
