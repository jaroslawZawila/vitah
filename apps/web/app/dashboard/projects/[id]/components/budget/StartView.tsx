"use client";

import { useId, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  BUDGET_INPUTS,
  type BudgetGeneration,
  type BudgetInput,
  type BudgetQuality,
  type ProjectDocument,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import ProgressBar from "../obra/ProgressBar";

const ACCEPT: Record<BudgetInput, string> = {
  plans: ".pdf,.jpg,.jpeg,.png,.webp",
  basic: ".pdf",
  execution: ".pdf",
  measurements: ".pdf,.xlsx,.bc3",
};

export type GenerateInput = { reference: string; quality: BudgetQuality; vatRateBp: number };

/**
 * Presentational: the Budget tab before there is a budget: up to four project
 * documents (each uploaded, or picked from the project's Documents) and the
 * AI's settings. Enough with one document; `onGenerate` starts the AI.
 */
export default function StartView({
  inputs,
  documents,
  uploading,
  failed,
  pending,
  error,
  onUpload,
  onChoose,
  onRemove,
  onGenerate,
  fileUrl,
}: {
  inputs: ProjectDocument[];
  /** Other project documents that could be used as an input. */
  documents: ProjectDocument[];
  /** Upload progress per slot, 0–100, while uploading. */
  uploading: Partial<Record<BudgetInput, number>>;
  /** The last AI run, when it failed. */
  failed: BudgetGeneration | null;
  pending: boolean;
  error?: string;
  onUpload?: (kind: BudgetInput, file: File) => void;
  onChoose?: (kind: BudgetInput, documentId: string) => void;
  onRemove?: (document: ProjectDocument) => void;
  onGenerate?: (input: GenerateInput) => void;
  fileUrl: (document: ProjectDocument) => string;
}) {
  const t = useTranslations("budget.start");
  const te = useTranslations("budget.generation.errors");
  const f = useObraFormat();
  const id = useId();
  const [dragging, setDragging] = useState<BudgetInput | null>(null);
  const filled = BUDGET_INPUTS.filter((kind) => inputs.some((d) => d.budgetInput === kind));
  const hasMeasurements = filled.includes("measurements");

  return (
    <div className="flex flex-col gap-4.5 lg:flex-row lg:items-start">
      <section className={cn(cardVariants(), "min-w-0 flex-1")} aria-labelledby="start-title">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 id="start-title">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
        </div>
        {failed && (
          <p className="rounded-[11px] border border-bad/30 bg-bad-soft px-3.5 py-3 text-sm text-bad" role="alert">
            <b>{t("failed")}</b> {te.has(failed.error ?? "") ? te(failed.error as "unexpected") : te("unexpected")}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {BUDGET_INPUTS.map((kind, index) => {
            const docs = inputs.filter((d) => d.budgetInput === kind);
            const progress = uploading[kind];
            const choices = documents.filter((d) => d.contentType === "application/pdf");
            return (
              <div key={kind} className="flex flex-col gap-3 rounded-[12px] border p-4">
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <h3 className="text-[15px] font-bold">{index + 1} · {t(`kinds.${kind}.title`)}</h3>
                    <p className={muted}>{t(`kinds.${kind}.hint`)}</p>
                  </div>
                  <Badge variant={docs.length > 0 ? "good" : "outline"}>{docs.length > 0 ? t("ready") : t("optional")}</Badge>
                </div>
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2.5 rounded-[10px] bg-raise px-3 py-2.5">
                    <FileText size={20} className="flex-none text-muted-foreground" aria-hidden />
                    <a href={fileUrl(doc)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm font-semibold">{doc.filename ?? doc.title}</span>
                      <span className="num text-xs text-muted-foreground">{f.fileSize(doc.sizeBytes)}</span>
                    </a>
                    {onRemove && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(doc)}>{t("remove")}</Button>
                    )}
                  </div>
                ))}
                {progress !== undefined ? (
                  <div className="flex items-center gap-2.5" aria-live="polite">
                    <ProgressBar pct={progress} />
                    <span className="num text-xs text-muted-foreground">{t("uploading", { pct: progress })}</span>
                  </div>
                ) : (
                  docs.length === 0 && onUpload && (
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(kind);
                      }}
                      onDragLeave={() => setDragging(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragging(null);
                        const file = event.dataTransfer.files[0];
                        if (file) onUpload(kind, file);
                      }}
                      className={cn("flex flex-col items-center gap-2 rounded-[10px] border-[1.5px] border-dashed bg-raise/50 p-4 text-center", dragging === kind && "border-primary bg-brand-soft")}
                    >
                      <Upload size={20} className="text-muted-foreground" aria-hidden />
                      <span className={muted}>{t("drop", { types: ACCEPT[kind].replaceAll(".", "").toUpperCase().replaceAll(",", ", ") })}</span>
                      <span className="flex flex-wrap justify-center gap-2">
                        <label className="inline-flex min-h-8 cursor-pointer items-center rounded-[7px] border bg-card px-2.5 text-[12.5px] font-semibold hover:bg-raise pointer-coarse:min-h-11">
                          {t("upload")}
                          <input type="file" className="sr-only" accept={ACCEPT[kind]} onChange={(event) => event.target.files?.[0] && onUpload(kind, event.target.files[0])} />
                        </label>
                        {onChoose && choices.length > 0 && (
                          <NativeSelect size="sm" aria-label={t("choose")} className="w-auto" value="" onChange={(event) => event.target.value && onChoose(kind, event.target.value)}>
                            <option value="">{t("choose")}</option>
                            {choices.map((d) => (
                              <option key={d.id} value={d.id}>{d.title}</option>
                            ))}
                          </NativeSelect>
                        )}
                      </span>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>

        <form
          className="flex flex-col gap-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onGenerate?.({
              reference: String(data.get("reference") ?? "").trim(),
              quality: data.get("quality") as BudgetQuality,
              vatRateBp: Number(data.get("vat")),
            });
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field>
              <Label htmlFor={`${id}-ref`}>{t("reference")}</Label>
              <Input id={`${id}-ref`} name="reference" className="font-mono" placeholder="041/2026" />
            </Field>
            <Field>
              <Label htmlFor={`${id}-quality`}>{t("quality")}</Label>
              <NativeSelect id={`${id}-quality`} name="quality" defaultValue="framer">
                <option value="framer">{t("qualities.framer")}</option>
                <option value="project">{t("qualities.project")}</option>
              </NativeSelect>
            </Field>
            <Field>
              <Label htmlFor={`${id}-vat`}>{t("vat")}</Label>
              <NativeSelect id={`${id}-vat`} name="vat" defaultValue="1000">
                <option value="1000">{t("vats.reduced")}</option>
                <option value="2100">{t("vats.general")}</option>
              </NativeSelect>
            </Field>
          </div>
          <FormError namespace="obra.errors" error={error} />
          <div className="flex flex-wrap items-center gap-3 border-t pt-3.5">
            {onGenerate && (
              <Button type="submit" disabled={pending || filled.length === 0}>
                {pending ? t("starting") : t("generate")}
              </Button>
            )}
            <span className={muted}>{filled.length === 0 ? t("needOne") : hasMeasurements ? t("time") : t("noMeasurements")}</span>
          </div>
        </form>
      </section>

      <aside className={cn(cardVariants(), "lg:w-[320px] lg:flex-none")}>
        <span className="eyebrow">{t("next")}</span>
        <ol className="flex flex-col gap-3">
          {(["read", "lines", "contingency", "review"] as const).map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="flex size-6 flex-none items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">{i + 1}</span>
              <span>
                <b>{t(`steps.${step}.title`)}</b> <span className="text-muted-foreground">{t(`steps.${step}.text`)}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className={`${muted} rounded-[10px] bg-raise px-3 py-2.5`}>{t("privacy")}</p>
      </aside>
    </div>
  );
}
