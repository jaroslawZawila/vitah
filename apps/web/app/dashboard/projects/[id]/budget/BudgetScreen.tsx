"use client";

// Container for the Budget tab: the only part that knows about server
// actions. The views in ../components/obra take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, BudgetLine, ProjectBudget } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  acceptRevisionAction,
  addChapterAction,
  addLineAction,
  createBudgetAction,
  createRevisionAction,
  deleteChapterAction,
  deleteLineAction,
  deleteRevisionAction,
  updateChapterAction,
  updateLineAction,
  updateRevisionAction,
} from "../../../../actions/budget";
import type { ObraState } from "../../../../actions/run";
import EmptyState from "../components/EmptyState";
import FormError from "../../../components/FormError";
import { SleepingCamera } from "../components/illustrations";
import Modal from "../components/Modal";
import BudgetChanges from "../components/obra/BudgetChanges";
import BudgetChapters from "../components/obra/BudgetChapters";
import BudgetKpis from "../components/obra/BudgetKpis";
import { cardHead, muted } from "../components/obra/classes";
import FieldsForm, { type Field } from "../components/obra/FieldsForm";
import { useObraFormat } from "../components/obra/format";
import Kpi from "../components/obra/Kpi";
import { useObraAction } from "../components/obra/useObraAction";
import TabHeader from "../components/TabHeader";

type Dialog =
  | { kind: "create" }
  | { kind: "revision" }
  | { kind: "chapter"; chapter?: BudgetChapter }
  | { kind: "line"; chapter: BudgetChapter; line?: BudgetLine };

/** The project's budget in the FRAMER model: revisions, chapters and lines. */
export default function BudgetScreen({
  projectId,
  projectRef,
  budget,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  budget: ProjectBudget;
  canManage: boolean;
}) {
  const t = useTranslations("obra.budget");
  const f = useObraFormat();
  const base = `/dashboard/projects/${projectId}`;
  const { revision } = budget;
  const [open, setOpen] = useState<Set<string>>(() => new Set(revision?.chapters.slice(0, 1).map((c) => c.code)));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { state, pending, run, confirmThen, reset } = useObraAction();
  const editable = canManage && revision?.status === "draft";
  const close = () => setDialog(null);

  function openDialog(next: Dialog) {
    reset();
    setDialog(next);
  }

  const toggle = (code: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const lineCount = revision?.chapters.reduce((sum, c) => sum + c.lines.length, 0) ?? 0;

  const actions = canManage && revision && (
    <span className="flex flex-wrap gap-2 print:hidden">
      <Button type="button" variant="outline" onClick={() => window.print()}>
        {t("export")}
      </Button>
      {revision.status === "draft" ? (
        <>
          <Button type="button" variant="outline" onClick={() => openDialog({ kind: "revision" })}>
            {t("editDetails")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => confirmThen(t("confirmDeleteDraft", { number: revision.number }), () => deleteRevisionAction(projectId, revision.id))}
          >
            {t("deleteDraft")}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => confirmThen(t("confirmAccept", { number: revision.number }), () => acceptRevisionAction(projectId, revision.id))}
          >
            {t("accept")}
          </Button>
        </>
      ) : (
        !budget.revisions.some((r) => r.status === "draft") && (
          <Button type="button" disabled={pending} onClick={() => run(() => createRevisionAction(projectId))}>
            {t("newRevision")}
          </Button>
        )
      )}
    </span>
  );

  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={t("summary", { reference: revision?.reference ?? t("noReference") })}
        action={actions}
      />
      {!dialog && <FormError namespace="obra.errors" error={state?.error} />}

      {!revision ? (
        <EmptyState
          illustration={<SleepingCamera />}
          title={t("emptyTitle")}
          text={t("emptyText")}
          action={
            canManage && (
              <Button type="button" onClick={() => openDialog({ kind: "create" })}>
                {t("create")}
              </Button>
            )
          }
        />
      ) : (
        <>
          <nav aria-label={t("revisions")} className="flex flex-wrap items-center gap-1.5">
            {budget.revisions
              .slice()
              .reverse()
              .map((r) => (
                <Link
                  key={r.id}
                  href={`${base}/budget?revision=${r.id}`}
                  aria-current={r.id === revision.id ? "true" : undefined}
                  className={cn(
                    "inline-flex min-h-8 items-center rounded-full border bg-card px-[11px] py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11",
                    r.id === revision.id && "border-foreground bg-foreground font-semibold text-background hover:text-background",
                  )}
                >
                  {t("revision", { number: r.number, total: f.money(r.totalCents), status: t(`revisionStatus.${r.status}`) })}
                </Link>
              ))}
          </nav>

          <BudgetKpis revision={revision} />
          <BudgetChanges revision={revision} />

          <section className={cardVariants()}>
            <div className={cardHead}>
              <h2>{t("detail")}</h2>
              <span className={muted}>
                {t("detailSummary", { chapters: revision.chapters.length, lines: lineCount })}
              </span>
            </div>
            <BudgetChapters
              revision={revision}
              open={open}
              onToggle={toggle}
              handlers={
                editable
                  ? {
                      onAddLine: (chapter) => openDialog({ kind: "line", chapter }),
                      onEditChapter: (chapter) => openDialog({ kind: "chapter", chapter }),
                      onDeleteChapter: (chapter) =>
                        confirmThen(t("confirmDeleteChapter", { code: chapter.code }), () => deleteChapterAction(projectId, chapter.id)),
                      onEditLine: (chapter, line) => openDialog({ kind: "line", chapter, line }),
                      onDeleteLine: (line) =>
                        confirmThen(t("confirmDeleteLine", { code: line.code }), () => deleteLineAction(projectId, line.id)),
                      onUpdateLine: (line, changes) => run(() => updateLineAction(projectId, line.id, changes)),
                    }
                  : undefined
              }
            />
            {editable && (
              <Button type="button" variant="outline" className="w-fit" onClick={() => openDialog({ kind: "chapter" })}>
                <span aria-hidden>+ </span>
                {t("addChapter")}
              </Button>
            )}
            <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-rail px-4 py-3.5 font-semibold text-rail-foreground">
              <span>{t("grandTotal", { number: revision.number })}</span>
              <span className="num text-rail-accent">{f.money(revision.totalCents)}</span>
            </div>
          </section>

          <section className="grid gap-3.5 md:grid-cols-3">
            <Kpi label={t("plan")} value={t("planLink")} href={`${base}/payments`} hints={[t("planHint")]} />
            <Kpi
              label={t("exclusions")}
              value={t("exclusionsCount", { count: revision.exclusions.length })}
              hints={revision.exclusions}
            />
            <Kpi label={t("guarantees")} value={t("guaranteesText")} hints={[t("guaranteesHint")]} />
          </section>
        </>
      )}

      {dialog && (
        <Modal open onOpenChange={(isOpen) => !isOpen && close()} title={dialogTitle(dialog, t)}>
          <FieldsForm
            fields={dialogFields(dialog, t, f, revision)}
            pending={pending}
            error={state?.error}
            onCancel={close}
            onSubmit={(values) => run(() => submitDialog(projectId, dialog, values, revision?.id, f), close)}
          />
        </Modal>
      )}
    </div>
  );
}

type T = ReturnType<typeof useTranslations<"obra.budget">>;
type F = ReturnType<typeof useObraFormat>;

function dialogTitle(dialog: Dialog, t: T) {
  switch (dialog.kind) {
    case "create":
      return t("create");
    case "revision":
      return t("editDetails");
    case "chapter":
      return dialog.chapter ? t("editChapter") : t("addChapter");
    case "line":
      return dialog.line ? t("editLine", { code: dialog.line.code }) : t("addLine");
  }
}

function dialogFields(dialog: Dialog, t: T, f: F, revision: ProjectBudget["revision"]): Field[] {
  switch (dialog.kind) {
    case "create":
      return [
        { name: "reference", label: t("form.reference") },
        { name: "number", label: t("form.number"), defaultValue: "0", inputMode: "numeric", hint: t("form.numberHint") },
      ];
    case "revision":
      return [
        { name: "reference", label: t("form.reference"), defaultValue: revision?.reference ?? "" },
        { name: "vat", label: t("form.vat"), defaultValue: f.pctInput(revision?.vatRateBp ?? 1000), inputMode: "decimal" },
        { name: "built", label: t("form.built"), defaultValue: revision?.builtAreaM2 ? f.decimal(revision.builtAreaM2) : "", inputMode: "decimal" },
        { name: "useful", label: t("form.useful"), defaultValue: revision?.usefulAreaM2 ? f.decimal(revision.usefulAreaM2) : "", inputMode: "decimal" },
        { name: "exclusions", label: t("form.exclusions"), multiline: true, defaultValue: revision?.exclusions.join("\n") ?? "" },
      ];
    case "chapter":
      return [
        { name: "code", label: t("form.code"), defaultValue: dialog.chapter?.code, required: true },
        { name: "name", label: t("form.name"), defaultValue: dialog.chapter?.name, required: true },
        { name: "changeNote", label: t("form.changeNote"), defaultValue: dialog.chapter?.changeNote ?? "" },
      ];
    case "line":
      return [
        { name: "code", label: t("form.code"), defaultValue: dialog.line?.code ?? `${dialog.chapter.code}.`, required: true },
        { name: "description", label: t("form.description"), multiline: true, defaultValue: dialog.line?.description, required: true },
        { name: "unit", label: t("form.unit"), defaultValue: dialog.line?.unit, required: true },
        { name: "quantity", label: t("form.quantity"), defaultValue: dialog.line ? f.quantity(dialog.line.quantity) : "", inputMode: "decimal", required: true },
        { name: "unitPrice", label: t("form.unitPrice"), defaultValue: dialog.line ? f.decimal(dialog.line.unitPriceCents / 100) : "", inputMode: "decimal", required: true },
      ];
  }
}

function submitDialog(
  projectId: string,
  dialog: Dialog,
  values: Record<string, string>,
  revisionId: string | undefined,
  f: F,
): Promise<ObraState> {
  /** A typed number, or NaN (which core rejects as `invalid_input`). */
  const number = (text: string) => f.parse(text) ?? Number.NaN;
  const optionalNumber = (text: string) => (text ? number(text) : null);
  switch (dialog.kind) {
    case "create":
      return createBudgetAction(projectId, { reference: values.reference, number: number(values.number || "0") });
    case "revision":
      return updateRevisionAction(projectId, revisionId!, {
        reference: values.reference,
        vatRateBp: f.hundredths(values.vat!),
        builtAreaM2: optionalNumber(values.built!),
        usefulAreaM2: optionalNumber(values.useful!),
        exclusions: values.exclusions,
      });
    case "chapter":
      return dialog.chapter
        ? updateChapterAction(projectId, dialog.chapter.id, values)
        : addChapterAction(projectId, revisionId!, values);
    case "line": {
      const input = {
        code: values.code,
        description: values.description,
        unit: values.unit,
        quantity: number(values.quantity!),
        unitPriceCents: f.hundredths(values.unitPrice!),
      };
      return dialog.line
        ? updateLineAction(projectId, dialog.line.id, input)
        : addLineAction(projectId, dialog.chapter.id, input);
    }
  }
}
