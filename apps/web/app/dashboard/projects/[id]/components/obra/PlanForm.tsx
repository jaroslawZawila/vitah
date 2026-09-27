"use client";

import { useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import formStyles from "../cardForm.module.css";
import FormError from "../FormError";
import { useObraFormat } from "./format";
import styles from "./obra.module.css";

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
      className={formStyles.form}
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
      <p className={styles.muted}>{t("planHint")}</p>
      {hitos.map((hito) => (
        <div key={hito.id} className={styles.planRow}>
          <span className={styles.code}>{hito.code}</span>
          <span className={styles.checkLabel}>{hito.name}</span>
          <span className={styles.pctInput}>
            <input
              name={`pct-${hito.id}`}
              className={styles.input}
              inputMode="decimal"
              aria-label={t("planPct", { code: hito.code })}
              defaultValue={f.pctInput(hito.pctBp)}
            />
            <span className={styles.pctSign} aria-hidden>%</span>
          </span>
          <input
            name={`chapters-${hito.id}`}
            className={styles.inputText}
            aria-label={t("planChapters", { code: hito.code })}
            defaultValue={hito.chapters.map((c) => c.code).join(", ")}
          />
        </div>
      ))}
      <FormError namespace="obra.errors" error={error} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={formStyles.primary} disabled={pending}>
          {pending ? t("planSaving") : t("planSave")}
        </button>
      </div>
    </form>
  );
}
