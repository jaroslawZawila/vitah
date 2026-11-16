"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import type { PurchaseSupplierGroup } from "@repo/core/contract";
import { companyHref } from "../../subcontratas/components/display";
import { cn } from "@/lib/utils";
import { touchLink } from "../../components/touch";
import { useVatLabel } from "../../components/vat-basis";
import { phoneFigures } from "../../components/phone-table";

/**
 * Below 768px the table reflows into one block per supplier (the same elements):
 * its name on top, then its figures two by two, each under its column's name.
 */
const phone = phoneFigures;

/** Presentational: the filtered orders grouped by supplier (by the server), the most contracted first. */
export default function SupplierTable({ groups, empty }: { groups: PurchaseSupplierGroup[]; empty: string }) {
  const t = useTranslations("purchasing.company.bySupplier");
  const tp = useTranslations("purchasing");
  const ty = useTranslations("subcontractors.fields.types");
  const f = usePurchaseFormat();
  const vat = useVatLabel();

  if (groups.length === 0) {
    return <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <Table className={cn(phone.block, "md:min-w-[760px]")} aria-label={t("label")}>
      <TableHeader className="max-md:hidden">
        <TableRow>
          <TableHead className="pl-[18px]">{t("supplier")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead className="text-right">{t("orders")}</TableHead>
          <TableHead>{t("projects")}</TableHead>
          <TableHead className="text-right">{vat(t("contracted"), "excl")}</TableHead>
          <TableHead className="pr-[18px] text-right">{vat(t("open"), "excl")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className={phone.block}>
        {groups.map((group) => (
          <TableRow key={group.id} className={phone.row}>
            <TableCell className="pl-[18px] font-semibold whitespace-normal max-md:col-span-2 max-md:p-0">
              <Link href={companyHref(group.id)} className={cn("text-brand-ink hover:text-primary", touchLink)}>
                {group.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground max-md:col-span-2 max-md:p-0">
              {group.suppliesOnly ? ty("supplier.label") : tp("order.subcontractor")}
            </TableCell>
            <TableCell className={cn("num text-right", phone.cell)}>
              <span className={phone.label}>{t("orders")}</span>
              {group.orders}
            </TableCell>
            <TableCell className={cn("num text-meta whitespace-normal", phone.cell)}>
              <span className={phone.label}>{t("projects")}</span>
              {group.projectRefs.join(", ")}
            </TableCell>
            <TableCell className={cn("num text-right", phone.cell)}>
              <span className={phone.label}>{vat(t("contracted"), "excl")}</span>
              {f.amount(group.contractedCents)}
            </TableCell>
            <TableCell className={cn("num pr-[18px] text-right", phone.cell)}>
              <span className={phone.label}>{vat(t("open"), "excl")}</span>
              {group.openCents ? f.amount(group.openCents) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
