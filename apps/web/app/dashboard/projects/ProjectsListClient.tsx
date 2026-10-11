"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Project = {
  id: string;
  ref: string;
  address: string;
  startDate: Date | null;
  completionDate: Date | null;
  client: { id: string; name: string | null; email: string } | null;
};

export default function ProjectsListClient({
  projects,
  canCreate,
}: {
  projects: Project[];
  /** Admins and managers create projects; viewers only read. */
  canCreate: boolean;
}) {
  const t = useTranslations("projectsPage");
  const format = useFormatter();
  // Calendar dates are stored at UTC midnight.
  const formatDate = (date: Date | null) =>
    date
      ? format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" })
      : "—";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center text-[13px] font-medium text-muted-foreground">
          {t("count", { count: projects.length })}
        </span>
        {canCreate && (
          <Link
            href="/dashboard/projects/new"
            className={cn(buttonVariants(), "ml-auto")}
          >
            + {t("newProject")}
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="py-10 text-center text-[13.5px] text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <Card size="list">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.ref")}</TableHead>
                <TableHead>{t("table.address")}</TableHead>
                <TableHead>{t("table.client")}</TableHead>
                <TableHead>{t("table.startDate")}</TableHead>
                <TableHead>{t("table.completionDate")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="num font-semibold text-primary">
                    {p.ref}
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    {p.address}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.client
                      ? (p.client.name ?? p.client.email)
                      : t("table.noClient")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(p.startDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(p.completionDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {t("table.view")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
