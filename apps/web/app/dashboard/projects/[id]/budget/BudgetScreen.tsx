"use client";

// Container for the Budget tab's pages: the only part that knows about server
// actions. The views in ../components/budget take props only.

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOptimistic, useState } from "react";
import type {
  BudgetChapter,
  BudgetCheck,
  BudgetConditions,
  BudgetLine,
  BudgetRevision,
  BudgetTexts,
  Hito,
  ProjectBudget,
  ProjectDocument,
} from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { FormActions } from "@/components/ui/field";
import {
  acceptRevisionAction,
  addLineAction,
  addOptionAction,
  createRevisionAction,
  deleteLineAction,
  deleteOptionAction,
  deleteRevisionAction,
  issueRevisionAction,
  optionFromLineAction,
  rejectRevisionAction,
  searchPriceBaseAction,
  updateChapterAction,
  updateLineAction,
  updateOptionAction,
  updateRevisionAction,
} from "../../../../actions/budget";
import { savePlanAction } from "../../../../actions/obra";
import FormError from "../../../components/FormError";
import AcceptDialog, { type AcceptInput } from "../components/budget/AcceptDialog";
import BudgetFrame from "../components/budget/BudgetFrame";
import { budgetHref, type BudgetTab } from "../components/budget/links";
import ChapterSummary from "../components/budget/ChapterSummary";
import ConditionsView from "../components/budget/ConditionsView";
import IssueDialog, { type IssueInput } from "../components/budget/IssueDialog";
import type { LineOps, LineParent } from "../components/budget/LineTable";
import LinesView, { type LineHandlers } from "../components/budget/LinesView";
import OptionSummary from "../components/budget/OptionSummary";
import OptionsView, { type OptionHandlers } from "../components/budget/OptionsView";
import ReviewChecklist from "../components/budget/ReviewChecklist";
import SummaryKpis from "../components/budget/SummaryKpis";
import TextsView from "../components/budget/TextsView";
import Modal from "../components/Modal";
import FieldsForm, { type Field } from "../components/obra/FieldsForm";
import { useObraFormat } from "../components/obra/format";
import PlanForm from "../components/obra/PlanForm";
import { useObraAction } from "../components/obra/useObraAction";

type Dialog =
  | { kind: "issue" }
  | { kind: "accept" }
  | { kind: "plan" }
  | { kind: "newLine"; parent: LineParent }
  | { kind: "editLine"; parent: LineParent; line: BudgetLine }
  | { kind: "move"; chapter: BudgetChapter; line: BudgetLine }
  | { kind: "newOption" };

type Props = {
  projectId: string;
  projectRef: string;
  site: string;
  clientName: string | null;
  budget: ProjectBudget & { revision: BudgetRevision };
  canManage: boolean;
  tab: BudgetTab;
  /** The chapter the Lines tab shows. */
  chapterCode?: string;
  inputs: ProjectDocument[];
  hitos: Hito[];
};

export default function BudgetScreen({ projectId, projectRef, site, clientName, budget, canManage, tab, chapterCode, inputs, hitos }: Props) {
  const t = useTranslations("budget");
  const f = useObraFormat();
  const router = useRouter();
  const { revisions } = budget;
  // The user's ticks show at once, over whatever the server sends meanwhile.
  const [checks, showTick] = useOptimistic(budget.revision.checks, (current, tick: { key: string; done: boolean }) =>
    current.map((c) => (c.key === tick.key ? { ...c, done: tick.done } : c)),
  );
  const revision = { ...budget.revision, checks };
  const { state, pending, run, confirmThen, reset } = useObraAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const editable = canManage && revision.status === "draft";
  const isNewest = revisions[0]?.id === revision.id;
  const revisionParam = isNewest ? null : revision.id;
  const href = (path: string, extra: Record<string, string> = {}) => budgetHref(projectId, path, revisionParam, extra);
  const chapterHref = (code: string) => href("/lines", { chapter: code });
  const close = () => setDialog(null);
  const open = (next: Dialog) => {
    reset();
    setDialog(next);
  };
  const updateRevision = (input: Record<string, unknown>) => updateRevisionAction(projectId, revision.id, input);
  const saveRevision = (input: Record<string, unknown>) => run(() => updateRevision(input));
  const nextNumber = revisions[0]!.number + 1;

  // ─── Header actions and the banner for where the revision stands ──────────
  let actions: React.ReactNode = null;
  let banner: React.ReactNode = null;
  if (canManage && isNewest) {
    if (revision.status === "draft") {
      actions = (
        <>
          <Button
            type="button"
            variant="ghost-destructive"
            onClick={() => confirmThen(t("confirmDeleteDraft", { number: revision.number }), () => deleteRevisionAction(projectId, revision.id))}
          >
            {t("deleteDraft")}
          </Button>
          <Button type="button" onClick={() => open({ kind: "issue" })}>
            {revision.number === 0 ? t("issueButton") : t("issueRevision", { number: revision.number })}
          </Button>
        </>
      );
    } else if (revision.status === "issued") {
      banner = (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-info/30 bg-info-soft px-4 py-3.5 text-sm">
          <span>
            <b>{t("issuedBanner", { issued: f.date(revision.issuedOn!), valid: revision.validUntil ? f.date(revision.validUntil) : "—" })}</b>{" "}
            <span className="text-muted-foreground">{revision.pdfs.general ? t("issuedBannerPdfs") : ""}</span>
          </span>
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => confirmThen(t("confirmReject", { number: revision.number }), () => rejectRevisionAction(projectId, revision.id))}>
              {t("reject")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => createRevisionAction(projectId))}>
              {t("newRevisionChanges", { number: nextNumber })}
            </Button>
            <Button type="button" size="sm" onClick={() => open({ kind: "accept" })}>
              {t("acceptButton")}
            </Button>
          </span>
        </div>
      );
    } else {
      actions = (
        <Button type="button" disabled={pending} onClick={() => run(() => createRevisionAction(projectId))}>
          {t("newRevision", { number: nextNumber })}
        </Button>
      );
    }
  }
  if (revision.status === "accepted") {
    banner = (
      <p className="rounded-[14px] border border-good/30 bg-good-soft px-4 py-3 text-sm">
        <b>{t("acceptedBanner", { date: revision.acceptedOn ? f.date(revision.acceptedOn) : "—" })}</b>
        {revision.acceptedBy && ` ${t("acceptedBy", { by: revision.acceptedBy })}`}
      </p>
    );
  } else if (revision.status === "rejected") {
    banner = (
      <p className="rounded-[14px] border border-bad/30 bg-bad-soft px-4 py-3 text-sm">{t("rejectedBanner", { date: revision.rejectedOn ? f.date(revision.rejectedOn) : "—" })}</p>
    );
  }

  // ─── Handlers for the views ───────────────────────────────────────────────
  const onSearch = (query: string, chapter?: string) => searchPriceBaseAction(query, chapter);
  const toggleCheck = (check: BudgetCheck) => {
    // One check per save, merged on the server: quick ticks don't undo each other.
    const tick = { key: check.key, done: !check.done };
    run(async () => {
      showTick(tick);
      return updateRevision({ reviewed: tick });
    });
  };
  const checkHref = (check: BudgetCheck) => (check.chapterCode ? chapterHref(check.chapterCode) : href("/texts"));
  // The same for a chapter's lines and an option's.
  const lineOps: LineOps = {
    onAddFromBase: (parent, item) => run(() => addLineAction(projectId, parent.id, { baseCode: item.code, quantity: 1 })),
    onAddFree: (parent) => open({ kind: "newLine", parent }),
    onUpdate: (line, changes) => run(() => updateLineAction(projectId, line.id, changes)),
    onEdit: (parent, line) => open({ kind: "editLine", parent, line }),
    onDelete: (line) => confirmThen(t("lines.confirmDelete", { code: line.code }), () => deleteLineAction(projectId, line.id)),
    onSearch,
  };
  const lineHandlers: LineHandlers = {
    ...lineOps,
    onRename: (chapter, name) => run(() => updateChapterAction(projectId, chapter.id, { name })),
    onNote: (chapter, pdfNote) => run(() => updateChapterAction(projectId, chapter.id, { pdfNote })),
    // The copy takes the next free code.
    onDuplicate: (chapter, line) =>
      run(() =>
        addLineAction(projectId, chapter.id, {
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          note: line.note,
          ...(line.baseCode ? { baseCode: line.baseCode } : {}),
        }),
      ),
    onDeduction: (line) => run(() => optionFromLineAction(projectId, line.id, { kind: "deduction" }), () => router.push(href("/options"))),
    onAlternative: (line) => run(() => optionFromLineAction(projectId, line.id, { kind: "alternative" }), () => router.push(href("/options"))),
    onMove: (chapter, line) => open({ kind: "move", chapter, line }),
  };
  const optionHandlers: OptionHandlers = {
    ...lineOps,
    onAddOption: (item) => run(() => addOptionAction(projectId, revision.id, { baseCode: item.code })),
    onAddEmptyOption: () => open({ kind: "newOption" }),
    onUpdateOption: (option, changes) => run(() => updateOptionAction(projectId, option.id, changes)),
    onDeleteOption: (option) => confirmThen(t("options.confirmDelete", { name: option.name }), () => deleteOptionAction(projectId, option.id)),
  };
  const saveTexts = (texts: Partial<BudgetTexts>) => saveRevision({ texts });
  const saveConditions = (conditions: Partial<BudgetConditions>) => saveRevision({ conditions });

  function issue(input: IssueInput) {
    run(() => issueRevisionAction(projectId, revision.id, input), close);
  }

  function accept({ acceptedOn, acceptedBy, chosenOptionIds, signed }: AcceptInput) {
    const data = new FormData();
    data.set("acceptedOn", acceptedOn);
    data.set("acceptedBy", acceptedBy);
    for (const id of chosenOptionIds) data.append("chosenOptionIds", id);
    if (signed) data.set("signed", signed);
    run(() => acceptRevisionAction(projectId, revision.id, data), close);
  }

  // ─── The tab ──────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  switch (tab) {
    case "summary":
      body = (
        <>
          {revision.model && (
            <ReviewChecklist checks={revision.checks} limit={4} allHref={href("/texts")} hrefOf={checkHref} onToggle={editable ? toggleCheck : undefined} />
          )}
          <SummaryKpis revision={revision} optionsHref={href("/options")} />
          <ChapterSummary revision={revision} hrefOf={chapterHref} onContingency={editable ? (contingencyPct) => saveRevision({ contingencyPct }) : undefined} />
          {revision.model && <OptionSummary options={revision.options} href={href("/options")} />}
        </>
      );
      break;
    case "lines":
      body = <LinesView revision={revision} code={chapterCode ?? "01"} hrefOf={chapterHref} optionsHref={href("/options")} handlers={editable ? lineHandlers : undefined} />;
      break;
    case "options":
      body = <OptionsView revision={revision} handlers={editable && revision.model ? optionHandlers : undefined} />;
      break;
    case "texts":
      body = (
        <>
          {revision.model && <ReviewChecklist checks={revision.checks} hrefOf={checkHref} onToggle={editable ? toggleCheck : undefined} />}
          <TextsView revision={revision} inputs={inputs} fileUrl={(doc) => `/api/v1/projects/${projectId}/documents/${doc.id}`} onSave={editable ? saveTexts : undefined} />
        </>
      );
      break;
    case "conditions":
      body = (
        <ConditionsView
          revision={revision}
          hitos={hitos}
          onTexts={editable ? saveTexts : undefined}
          onConditions={editable ? saveConditions : undefined}
          onEditPlan={canManage ? () => open({ kind: "plan" }) : undefined}
        />
      );
      break;
  }

  return (
    <BudgetFrame
      projectId={projectId}
      projectRef={projectRef}
      site={site}
      revision={revision}
      revisions={revisions}
      tab={tab}
      chapterCode={chapterCode}
      inputCount={inputs.length}
      saving={pending}
      actions={actions}
      banner={banner}
    >
      {!dialog && <FormError namespace="obra.errors" error={state?.error} />}
      {body}
      {dialog && (
        <Modal open onOpenChange={(isOpen) => !isOpen && close()} title={dialogTitle(dialog, t, revision)}>
          {dialog.kind === "issue" ? (
            <IssueDialog
              revision={revision}
              clientName={clientName}
              reviewHref={href("")}
              pdfHref={(kind) => href("/pdf", { kind })}
              pending={pending}
              error={state?.error}
              onSubmit={issue}
              onCancel={close}
            />
          ) : dialog.kind === "accept" ? (
            <AcceptDialog revision={revision} firstHitoBp={hitos[0]?.pctBp ?? 500} pending={pending} error={state?.error} onSubmit={accept} onCancel={close} />
          ) : dialog.kind === "plan" ? (
            <PlanForm hitos={hitos} pending={pending} error={state?.error} onCancel={close} onSubmit={(changes) => run(() => savePlanAction(projectId, changes), close)} />
          ) : dialog.kind === "move" ? (
            <MoveForm
              chapters={revision.chapters.filter((c) => c.id !== dialog.chapter.id && !c.lines.some((l) => l.source === "computed"))}
              pending={pending}
              error={state?.error}
              onCancel={close}
              onSubmit={(chapterId) => run(() => updateLineAction(projectId, dialog.line.id, { chapterId }), close)}
            />
          ) : (
            <FieldsForm
              fields={dialogFields(dialog, t, f)}
              pending={pending}
              error={state?.error}
              onCancel={close}
              onSubmit={(values) => run(() => submitDialog(projectId, revision.id, dialog, values, f), close)}
            />
          )}
        </Modal>
      )}
    </BudgetFrame>
  );
}

/** Presentational: where to move a line (shown in a modal). */
function MoveForm({
  chapters,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  chapters: BudgetChapter[];
  pending: boolean;
  error?: string;
  onSubmit: (chapterId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("budget.lines");
  const [target, setTarget] = useState(chapters[0]?.id ?? "");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(target);
      }}
    >
      <NativeSelect aria-label={t("moveTo")} value={target} onChange={(event) => setTarget(event.target.value)}>
        {chapters.map((c) => (
          <option key={c.id} value={c.id}>{`${c.code} ${c.name}`}</option>
        ))}
      </NativeSelect>
      <FormError namespace="obra.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
        <Button type="submit" disabled={pending || !target}>{t("moveSubmit")}</Button>
      </FormActions>
    </form>
  );
}

type T = ReturnType<typeof useTranslations<"budget">>;
type F = ReturnType<typeof useObraFormat>;

function dialogTitle(dialog: Dialog, t: T, revision: BudgetRevision) {
  switch (dialog.kind) {
    case "issue":
      return t("issue.title", { number: revision.number });
    case "accept":
      return t("accept.title", { number: revision.number });
    case "plan":
      return t("conditions.editPlan");
    case "newLine":
      return isOption(dialog.parent) ? t("options.freeLine") : t("lines.addFree");
    case "editLine":
      return t("lines.editTitle", { code: dialog.line.code });
    case "move":
      return t("lines.moveTitle", { code: dialog.line.code });
    case "newOption":
      return t("options.empty");
  }
}

function dialogFields(dialog: Dialog, t: T, f: F): Field[] {
  const line = dialog.kind === "editLine" ? dialog.line : null;
  switch (dialog.kind) {
    case "newOption":
      return [
        { name: "name", label: t("form.name"), required: true },
        { name: "intro", label: t("form.intro"), multiline: true },
      ];
    case "newLine":
    case "editLine": {
      const option = isOption(dialog.parent);
      // A new line takes the chapter's next free code; an option's follow the options.
      return [
        ...(option || !line ? [] : [{ name: "code", label: t("form.code"), defaultValue: line.code, required: true }]),
        { name: "description", label: t("form.description"), multiline: true, defaultValue: line?.description, required: true },
        { name: "unit", label: t("form.unit"), defaultValue: line?.unit ?? "ud", required: true },
        { name: "quantity", label: t("form.quantity"), defaultValue: line ? f.quantity(line.quantity) : "1", inputMode: "decimal" as const, required: true },
        {
          name: "unitPrice",
          label: t("form.unitPrice"),
          defaultValue: line ? f.decimal(line.unitPriceCents / 100) : "",
          inputMode: "decimal" as const,
          required: true,
          hint: option ? t("form.negativeHint") : undefined,
        },
        { name: "note", label: t("form.note"), multiline: true, defaultValue: line?.note ?? "" },
      ];
    }
    default:
      return [];
  }
}

const isOption = (parent: LineParent) => "optionKind" in parent;

function submitDialog(projectId: string, revisionId: string, dialog: Dialog, values: Record<string, string>, f: F) {
  const number = (text: string) => f.parse(text) ?? Number.NaN;
  switch (dialog.kind) {
    case "newOption":
      return addOptionAction(projectId, revisionId, { name: values.name, intro: values.intro, optionKind: "extra" });
    case "newLine":
      return addLineAction(projectId, dialog.parent.id, {
        ...(isOption(dialog.parent) ? {} : { source: "estimated" }),
        description: values.description,
        unit: values.unit,
        quantity: number(values.quantity!),
        unitPriceCents: f.signedHundredths(values.unitPrice!),
        note: values.note,
      });
    case "editLine":
      return updateLineAction(projectId, dialog.line.id, {
        ...(isOption(dialog.parent) ? {} : { code: values.code }),
        description: values.description,
        unit: values.unit,
        quantity: number(values.quantity!),
        unitPriceCents: f.signedHundredths(values.unitPrice!),
        note: values.note,
      });
    default:
      throw new Error(`No form for ${dialog.kind}`);
  }
}
