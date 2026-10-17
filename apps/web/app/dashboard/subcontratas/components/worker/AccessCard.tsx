"use client";

import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import type { SubcontractorKind, WorkerAccess } from "@repo/core/contract";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { AccessBadge } from "../Badges";
import { useAccessReason } from "../display";

/**
 * Presentational: "Acceso a obra" — the six rules, each passed or failed with
 * its reasons. The container recomputes `access` as the form changes.
 */
export default function AccessCard({
  access,
  kind,
  obras,
  obraId,
  onObra,
}: {
  access: WorkerAccess;
  kind?: SubcontractorKind;
  obras: { projectId: string; projectRef: string }[];
  obraId: string;
  onObra: (projectId: string) => void;
}) {
  const t = useTranslations("subcontractors");
  const tw = useTranslations("subcontractors.worker.access");
  const reason = useAccessReason();
  const border = { ok: "border-good", pending: "border-yel", blocked: "border-bad" }[access.status];

  return (
    <Card className={cn("border-2", border)} aria-labelledby="worker-access-title" aria-live="polite">
      <p id="worker-access-title" className="eyebrow m-0">
        {tw("title")}
      </p>
      <div className="flex items-center gap-2.5">
        <span className="font-heading text-[30px] leading-none font-bold">{t(`access.${access.status}`)}</span>
        <AccessBadge status={access.status} className="sr-only" />
      </div>
      {obras.length > 0 && (
        <Field>
          <Label htmlFor="worker-access-obra">{tw("obra")}</Label>
          <NativeSelect id="worker-access-obra" value={obraId} onChange={(e) => onObra(e.target.value)}>
            <NativeSelectOption value="">{tw("anywhere")}</NativeSelectOption>
            {obras.map((o) => (
              <NativeSelectOption key={o.projectId} value={o.projectId}>
                {o.projectRef}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {access.checks.map((check) => (
          <li key={check.rule} className="flex items-start gap-2.5 border-t py-2.5 text-[13.5px]">
            <span
              className={cn(
                "grid size-[22px] flex-none place-items-center rounded-full",
                check.ok ? "bg-good-soft text-good" : check.blocking ? "bg-bad-soft text-bad" : "bg-yel-soft text-yel",
              )}
            >
              {check.ok ? (
                <Check aria-label={tw("passed")} className="size-3" strokeWidth={2.4} />
              ) : (
                <X aria-label={tw("failed")} className="size-3" strokeWidth={2.4} />
              )}
            </span>
            <span className="min-w-0">
              <b className="font-semibold">{t(`accessRules.${check.rule}.title`)}</b>
              {check.reasons.map((r, i) => (
                <span key={i} className={cn("block text-[12.5px] font-medium", check.blocking ? "text-bad" : "text-yel")}>
                  {reason(r, kind)}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
