"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import type { SupplierGroup } from "../../projects/[id]/components/purchasing/orders";
import { companyHref } from "../../subcontratas/components/display";

/** Presentational: the filtered orders grouped by supplier, the most contracted first. */
export default function SupplierTable({ groups, empty }: { groups: SupplierGroup[]; empty: string }) {
  const t = useTranslations("purchasing.company.bySupplier");
  const tp = useTranslations("purchasing");
  const ty = useTranslations("subcontractors.fields.types");
  const f = usePurchaseFormat();

  if (groups.length === 0) {
    return <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{empty}</p>;
  }
  return (
    <Table className="min-w-[760px] text-[13px]" aria-label={t("label")}>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-[18px]">{t("supplier")}</TableHead>
          <TableHead>{t("kind")}</TableHead>
          <TableHead className="text-right">{t("orders")}</TableHead>
          <TableHead>{t("projects")}</TableHead>
          <TableHead className="text-right">{t("contracted")}</TableHead>
          <TableHead className="pr-[18px] text-right">{t("open")}</TableHead>
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
            <TableCell className="num text-[12px] whitespace-normal">{group.projectRefs.join(", ")}</TableCell>
            <TableCell className="num text-right">{f.amount(group.contractedCents)}</TableCell>
            <TableCell className="num pr-[18px] text-right">{group.openCents ? f.amount(group.openCents) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
