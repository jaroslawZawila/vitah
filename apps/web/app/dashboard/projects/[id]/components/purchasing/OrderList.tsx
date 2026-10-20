"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { orderLabel, type PurchaseOrderListItem } from "@repo/core/contract";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Dash } from "../construction/SummaryTable";
import { usePurchaseFormat } from "./format";
import { contractedCents } from "./orders";
import { LatePill, PurchaseStatusPill } from "./pills";

/**
 * Which list: a project's Compras tab, every order of the company (with the
 * obra of each), or one supplier's orders (its ficha, no supplier column).
 */
export type OrderListVariant = "project" | "company" | "supplier";

/** The supplier's kind line under its name: "Material · CAE pendiente". */
function SupplierLine({ order }: { order: PurchaseOrderListItem }) {
  const t = useTranslations("purchasing");
  const caePending = !order.suppliesOnly && order.caeStatus !== null && order.caeStatus !== "apta";
  return (
    <div className="text-[12px] text-muted-foreground">
      {t(`kind.${order.kind}`)}
      {caePending && (
        <>
          {" · "}
          <span className="font-semibold text-warn">{t(`cae.${order.caeStatus}`)}</span>
        </>
      )}
    </div>
  );
}

function When({ order }: { order: PurchaseOrderListItem }) {
  const f = usePurchaseFormat();
  const when = f.when(order);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap">
      <span className="num">{when ?? "—"}</span>
      {order.lateDays !== null && <LatePill days={order.lateDays} />}
    </span>
  );
}

/**
 * Presentational: orders as a table from 768px and as cards on phones. The
 * company and supplier lists end with what the shown orders contract
 * (pending and cancelled ones don't add up).
 */
export default function OrderList({
  orders,
  variant,
  orderHref,
  projectHref,
  empty,
}: {
  /** Already filtered. */
  orders: PurchaseOrderListItem[];
  variant: OrderListVariant;
  orderHref: (order: PurchaseOrderListItem) => string;
  /** The obra's Compras tab, for the company and supplier lists. */
  projectHref?: (order: PurchaseOrderListItem) => string;
  /** What to say when there is nothing to show. */
  empty: string;
}) {
  const t = useTranslations("purchasing.list");
  const tp = useTranslations("purchasing");
  const f = usePurchaseFormat();
  // The project's own list leaves the obra out; a supplier's, the supplier.
  const inProject = variant === "project";
  const isCompany = variant === "company";
  const withSupplier = variant !== "supplier";

  if (orders.length === 0) {
    return <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{empty}</p>;
  }

  const ref = (order: PurchaseOrderListItem) =>
    projectHref ? (
      <Link href={projectHref(order)} className="num text-[12px] text-muted-foreground hover:text-primary">
        {order.projectRef}
      </Link>
    ) : (
      <span className="num text-[12px] text-muted-foreground">{order.projectRef}</span>
    );
  const number = (order: PurchaseOrderListItem) => (
    <Link href={orderHref(order)} className="num font-semibold text-brand-ink hover:text-primary">
      {orderLabel(order.number)}
    </Link>
  );
  const chapters = (order: PurchaseOrderListItem) => order.chapterCodes.join(", ");
  const footer = isCompany ? t("footer", { count: orders.length }) : t("supplierFooter");

  return (
    <>
      {/* Phones: one card per order. */}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 px-3 pb-3 md:hidden" aria-label={t("cards")}>
        {orders.map((order) => (
          <li key={order.id} className="relative rounded-xl border bg-card px-4 py-3.5 shadow-card">
            <div className="flex items-center justify-between gap-2.5">
              <span className="num font-semibold text-brand-ink">
                {!inProject && <span className="font-normal text-muted-foreground">{order.projectRef} · </span>}
                <Link href={orderHref(order)} className="after:absolute after:inset-0 hover:text-primary">
                  {orderLabel(order.number)}
                </Link>
                {order.chapterCodes.length > 0 && (
                  <span className="font-normal text-muted-foreground"> · {t("chapterShort", { codes: chapters(order) })}</span>
                )}
              </span>
              <PurchaseStatusPill status={order.status} />
            </div>
            {withSupplier && <div className="mt-2 font-semibold">{order.supplierName}</div>}
            <div className="mt-0.5 text-[13px] text-muted-foreground">{order.description}</div>
            <div className="mt-2.5 flex items-center justify-between gap-2.5 text-[13px]">
              <When order={order} />
              <span className="num font-semibold">{f.money(order.amountCents)}</span>
            </div>
          </li>
        ))}
      </ul>

      {/* From 768px: the table. */}
      <div className="hidden md:block">
        <Table className={cn("text-[13px]", inProject ? "min-w-[940px]" : "min-w-[1060px]")} aria-label={t("table")}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{inProject ? t("number") : t("projectNumber")}</TableHead>
              {withSupplier && <TableHead>{t("supplier")}</TableHead>}
              <TableHead>{t("concept")}</TableHead>
              {inProject && <TableHead>{t("chapter")}</TableHead>}
              <TableHead className="text-right">{t("amount")}</TableHead>
              <TableHead className="text-right">{t("invoiced")}</TableHead>
              {isCompany && <TableHead>{t("orderedOn")}</TableHead>}
              <TableHead>{inProject ? t("expected") : t("when")}</TableHead>
              <TableHead className="pr-[18px]">{t("status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="pl-[18px] whitespace-nowrap">
                  {inProject ? (
                    number(order)
                  ) : (
                    <>
                      {ref(order)}
                      <br />
                      {number(order)}
                    </>
                  )}
                </TableCell>
                {withSupplier && (
                  <TableCell className="min-w-[180px] whitespace-normal">
                    <div className="font-semibold">{order.supplierName}</div>
                    <SupplierLine order={order} />
                  </TableCell>
                )}
                <TableCell className="max-w-[300px] min-w-[200px] whitespace-normal">
                  {order.description}
                  {!inProject && order.chapterCodes.length > 0 && (
                    <span className="num text-[12px] text-muted-foreground"> {t("chapterShort", { codes: chapters(order) })}</span>
                  )}
                </TableCell>
                {inProject && <TableCell className="num">{chapters(order) || <Dash />}</TableCell>}
                <TableCell className="num text-right">{f.amount(order.amountCents)}</TableCell>
                <TableCell className="num text-right text-muted-foreground">
                  {order.invoicedCents ? f.ratio(order.invoicedCents, order.amountCents) : <Dash />}
                </TableCell>
                {isCompany && (
                  <TableCell className="num whitespace-nowrap">{order.orderedOn ? f.shortDay(order.orderedOn) : <Dash />}</TableCell>
                )}
                <TableCell>
                  <When order={order} />
                </TableCell>
                <TableCell className="pr-[18px]">
                  <PurchaseStatusPill status={order.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {!inProject && (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="pl-[18px]" colSpan={isCompany ? 3 : 2}>
                  {footer}
                </TableCell>
                <TableCell className="num text-right">{f.amount(contractedCents(orders))}</TableCell>
                <TableCell colSpan={isCompany ? 4 : 3} className="pr-[18px] text-[12px] font-normal text-muted-foreground">
                  {tp("notCounted")}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </>
  );
}
