"use client";

import { useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import FormError from "../../../../components/FormError";
import { useObraFormat } from "./format";
import { codeChip, muted, pctInput } from "./classes";

export type PlanChange = { id: string; pctBp: number; chapterCodes: string[] };

/** Presentational: every hito's % and chapters at once (shown in a modal). Only changes are submitted. */
export default function PlanForm({
  hitos,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  hitos: Hito[];
  onSubmit: (changes: PlanChange[]) => void;
  onCancel: () => void;
  pending: boolean;
  error?: string;
}) {
  const t = useTranslations("obra.payments");
  const f = useObraFormat();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const changes = hitos.flatMap((hito) => {
          const pctBp = f.hundredths(String(data.get(`pct-${hito.id}`) ?? ""));
          const chapterCodes = String(data.get(`chapters-${hito.id}`) ?? "")
            .split(",")
            .map((code) => code.trim())
            .filter(Boolean);
          const same =
            pctBp === hito.pctBp && chapterCodes.join() === hito.chapters.map((c) => c.code).join();
          return same ? [] : [{ id: hito.id, pctBp, chapterCodes }];
        });
        onSubmit(changes);
      }}
    >
      <p className={muted}>{t("planHint")}</p>
      {hitos.map((hito) => (
        <div key={hito.id} className="flex flex-wrap items-center gap-2.5 border-b py-2 text-[13.5px]">
          <span className={codeChip}>{hito.code}</span>
          <span className="min-w-0 flex-1 font-medium">{hito.name}</span>
          <span className={pctInput.root}>
            <Input
              name={`pct-${hito.id}`}
              className={pctInput.input}
              inputMode="decimal"
              aria-label={t("planPct", { code: hito.code })}
              defaultValue={f.pctInput(hito.pctBp)}
            />
            <span className={pctInput.sign} aria-hidden>%</span>
          </span>
          <Input
            name={`chapters-${hito.id}`}
            className="flex-[1_1_160px]"
            aria-label={t("planChapters", { code: hito.code })}
            defaultValue={hito.chapters.map((c) => c.code).join(", ")}
          />
        </div>
      ))}
      <FormError namespace="obra.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("planSaving") : t("planSave")}
        </Button>
      </FormActions>
    </form>
  );
}
