"use client";

import { useTranslations } from "next-intl";
import { IdCard } from "lucide-react";
import type { AccessCheckResult, ProjectOption, SubcontractorError } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import FormError from "../../../components/FormError";
import { AccessBadge } from "../Badges";
import { useAccessReason } from "../display";

/**
 * Presentational: "Comprobar acceso" at the site entrance — a DNI/NIE or TPC
 * number, optionally on one obra, and who it is and whether they may enter.
 */
export default function CheckAccessPanel({
  projects,
  projectId,
  pending,
  result,
  error,
  onCheck,
}: {
  projects: ProjectOption[];
  projectId: string;
  pending: boolean;
  result: AccessCheckResult | null;
  error?: SubcontractorError;
  onCheck: (input: { query: string; projectId: string }) => void;
}) {
  const t = useTranslations("subcontractors.workers.check");
  const reason = useAccessReason();
  const failing = result?.access?.checks.filter((c) => !c.ok).flatMap((c) => c.reasons) ?? [];

  return (
    <form
      className={cardVariants({ className: "gap-3" })}
      aria-labelledby="check-access-title"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onCheck({ query: String(data.get("query") ?? ""), projectId: String(data.get("projectId") ?? "") });
      }}
    >
      <h2 id="check-access-title">{t("title")}</h2>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Field>
          <Label htmlFor="check-query">{t("query")}</Label>
          <Input id="check-query" name="query" required className="num" autoComplete="off" />
        </Field>
        <Field>
          <Label htmlFor="check-project">{t("project")}</Label>
          <NativeSelect id="check-project" name="projectId" defaultValue={projectId}>
            <NativeSelectOption value="">{t("anyProject")}</NativeSelectOption>
            {projects.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.ref}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={pending}>
          <IdCard aria-hidden />
          {pending ? t("checking") : t("submit")}
        </Button>
      </div>
      <FormError namespace="subcontractors.errors" error={error} />
      {result && (
        <div role="status" className="flex flex-col gap-1.5 rounded-[10px] bg-raise px-3.5 py-3 text-[13.5px]">
          {result.worker && result.access ? (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <AccessBadge status={result.access.status} />
                <span>
                  <b className="font-semibold">{result.worker.name}</b> · {result.worker.subcontractorName}
                </span>
              </div>
              {failing.length > 0 && (
                <ul className="m-0 list-disc pl-5 text-muted-foreground">
                  {failing.map((r, i) => (
                    <li key={i}>{reason(r)}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{t("notFound")}</span>
          )}
        </div>
      )}
    </form>
  );
}
