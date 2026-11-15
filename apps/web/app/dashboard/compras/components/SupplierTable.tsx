"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import type { PurchaseSupplierGroup } from "@repo/core/contract";
import { companyHref } from "../../subcontratas/components/display";
import { useVatLabel } from "../../components/vat-basis";

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
    <Table className="min-w-[760px]" aria-label={t("label")}>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-[18px]">{t("supplier")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead className="text-right">{t("orders")}</TableHead>
          <TableHead>{t("projects")}</TableHead>
          <TableHead className="text-right">{vat(t("contracted"), "excl")}</TableHead>
          <TableHead className="pr-[18px] text-right">{vat(t("open"), "excl")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <TableRow key={group.id}>
            <TableCell className="pl-[18px] font-semibold whitespace-normal">
              <Link href={companyHref(group.id)} className="text-brand-ink hover:text-primary">
                {group.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {group.suppliesOnly ? ty("supplier.label") : tp("order.subcontractor")}
            </TableCell>
            <TableCell className="num text-right">{group.orders}</TableCell>
            <TableCell className="num text-meta whitespace-normal">{group.projectRefs.join(", ")}</TableCell>
            <TableCell className="num text-right">{f.amount(group.contractedCents)}</TableCell>
            <TableCell className="num pr-[18px] text-right">{group.openCents ? f.amount(group.openCents) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
