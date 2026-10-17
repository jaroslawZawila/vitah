"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, X } from "lucide-react";
import {
  ISSUE_FILE_TYPES,
  fileTypeOf,
  ISSUE_KINDS,
  ISSUE_PARTIES,
  ISSUE_STATUSES,
  MAX_ISSUE_FILE_BYTES,
  MAX_ISSUE_TEXT,
  type IssueFile,
  type IssueKind,
  type IssueParty,
  type IssueStatus,
  type ObraError,
  type ObraIssue,
} from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { useControlFormat } from "./format";
import { IssueKindPill, IssueStatusPill } from "./pills";
import { useImpact, useIssueRef } from "./SummaryCards";

// Presentational: the issues and changes log (records and the form that
// creates or edits one).

/** One record: what happened, who, its estimated impact and attachments. */
export function IssueCard({
  issue,
  chapterName,
  fileUrl,
  onEdit,
}: {
  issue: ObraIssue;
  chapterName?: string;
  fileUrl: (issue: ObraIssue, file: IssueFile) => string;
  /** Omitted for viewers. */
  onEdit?: () => void;
}) {
  const t = useTranslations("construction.issues");
  const tp = useTranslations("construction.issueParty");
  const f = useControlFormat();
  const ref = useIssueRef();
  const impact = useImpact();

  return (
    <article className={cn(cardVariants(), "gap-2")} aria-label={ref(issue)}>
      <div className="flex flex-wrap items-center gap-2">
        <IssueKindPill kind={issue.kind} />
        <span className="num text-muted-foreground">
          {ref(issue)} · {f.day(issue.occurredOn)}
        </span>
        <span className="text-[13px] font-semibold">
          {issue.chapterCode}
          {chapterName && ` · ${chapterName}`}
        </span>
        <span className="ml-auto">
          <IssueStatusPill status={issue.status} />
        </span>
      </div>
      <p className="text-[14px] leading-snug whitespace-pre-line">{issue.description}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        <span>
          {tp(issue.party)}
          {issue.partyName && ` · ${issue.partyName}`}
        </span>
        <span>
          {t("cost")}: <span className="num">{impact.cost(issue) ?? t("notEstimated")}</span>
        </span>
        <span>
          {t("schedule")}: <span className="num">{impact.days(issue) ?? t("notEstimated")}</span>
        </span>
        {issue.files.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Paperclip aria-hidden className="size-3.5" />
            {issue.files.map((file) => (
              <a
                key={file.id}
                href={fileUrl(issue, file)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-info hover:underline"
              >
                {file.filename}
              </a>
            ))}
          </span>
        )}
        {onEdit && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto text-brand-ink" onClick={onEdit} aria-label={t("editLabel", { ref: ref(issue) })}>
            {t("edit")}
          </Button>
        )}
      </div>
    </article>
  );
}

/** The fields of a record as the form sends them to core. */
export type IssueValues = {
  kind: IssueKind;
  occurredOn: string;
  chapterCode: string;
  description: string;
  party: IssueParty;
  partyName: string;
  /** Null when left empty. */
  costImpactCents: number | null;
  scheduleImpactDays: number | null;
  status: IssueStatus;
};

/** Why an attachment can't go up, checked before sending it. */
export function fileProblem(file: File): ObraError | null {
  if (!fileTypeOf(file.name, ISSUE_FILE_TYPES)) return "invalid_file_type";
  if (file.size > MAX_ISSUE_FILE_BYTES) return "file_too_large";
  return null;
}

/**
 * Creates a record, or edits `issue`. Attachments are uploaded after it is
 * saved; an edited record's files can be removed one by one.
 */
export function IssueForm({
  issue,
  chapters,
  today,
  chapterCode,
  pending,
  progress,
  error,
  onSubmit,
  onCancel,
  onDeleteFile,
  fileUrl,
  className,
  bare = false,
}: {
  issue?: ObraIssue | null;
  chapters: { code: string; name: string }[];
  today: string;
  /** The chapter a new record starts on (from a chapter's page or row). */
  chapterCode?: string;
  pending: boolean;
  /** While attachments upload: "2 de 3". */
  progress?: { done: number; total: number } | null;
  error?: ObraError;
  onSubmit: (values: IssueValues, files: File[]) => void;
  onCancel: () => void;
  onDeleteFile?: (file: IssueFile) => void;
  fileUrl?: (file: IssueFile) => string;
  className?: string;
  /** Inside a dialog: no card, no title. */
  bare?: boolean;
}) {
  const t = useTranslations("construction.issues");
  const tk = useTranslations("construction.issueKind");
  const tp = useTranslations("construction.issueParty");
  const ts = useTranslations("construction.issueStatus");
  const f = useControlFormat();
  const ref = useIssueRef();
  const [kind, setKind] = useState<IssueKind>(issue?.kind ?? "issue");
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<ObraError | null>(null);
  const id = (name: string) => `issue-${issue?.id ?? "new"}-${name}`;

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const cost = text("cost");
    const days = text("days");
    const costCents = cost ? f.signedHundredths(cost) : null;
    const dayCount = days ? Number(days) : null;
    if ((costCents !== null && !Number.isFinite(costCents)) || (dayCount !== null && !Number.isInteger(dayCount))) {
      setLocalError("invalid_input");
      return;
    }
    const problem = files.map(fileProblem).find(Boolean);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    onSubmit(
      {
        kind,
        occurredOn: text("occurredOn"),
        chapterCode: text("chapterCode"),
        description: text("description"),
        party: text("party") as IssueParty,
        partyName: text("partyName"),
        costImpactCents: costCents,
        scheduleImpactDays: dayCount,
        status: text("status") as IssueStatus,
      },
      files,
    );
  }

  const title = issue ? t("editTitle", { ref: ref(issue) }) : t("newTitle");

  return (
    <form
      aria-label={title}
      className={cn(!bare && cardVariants(), "flex flex-col gap-3.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      {!bare && <h2>{title}</h2>}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t("kind")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {ISSUE_KINDS.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2 rounded-[9px] border bg-card px-3 text-[13.5px] pointer-coarse:min-h-11",
                kind === option && "border-primary bg-brand-soft font-semibold",
              )}
            >
              <input type="radio" name="kind" value={option} checked={kind === option} onChange={() => setKind(option)} className="accent-primary" />
              {tk(option)}
            </label>
          ))}
        </div>
        <FieldDescription>{t("kindHint")}</FieldDescription>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={id("date")}>{t("date")}</Label>
          <Input id={id("date")} name="occurredOn" type="date" className="num" required max={today} defaultValue={issue?.occurredOn ?? today} />
        </Field>
        <Field>
          <Label htmlFor={id("chapter")}>{t("chapter")}</Label>
          <NativeSelect id={id("chapter")} name="chapterCode" required defaultValue={issue?.chapterCode ?? chapterCode ?? ""}>
            <NativeSelectOption value="" disabled>
              {t("pickChapter")}
            </NativeSelectOption>
            {chapters.map((c) => (
              <NativeSelectOption key={c.code} value={c.code}>
                {c.code} · {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field>
        <Label htmlFor={id("description")}>{t("descriptionField")}</Label>
        <Textarea
          id={id("description")}
          name="description"
          rows={3}
          required
          maxLength={MAX_ISSUE_TEXT}
          placeholder={t("descriptionPlaceholder")}
          defaultValue={issue?.description ?? ""}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={id("party")}>{t("party")}</Label>
          <NativeSelect id={id("party")} name="party" defaultValue={issue?.party ?? "subcontractor"}>
            {ISSUE_PARTIES.map((party) => (
              <NativeSelectOption key={party} value={party}>
                {tp(party)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <Label htmlFor={id("partyName")}>
            {t("partyName")} <Optional />
          </Label>
          <Input id={id("partyName")} name="partyName" maxLength={200} placeholder={t("partyNamePlaceholder")} defaultValue={issue?.partyName ?? ""} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={id("cost")}>
            {t("costImpact")} <Optional />
          </Label>
          <Input
            id={id("cost")}
            name="cost"
            inputMode="decimal"
            className="num"
            placeholder={t("costPlaceholder")}
            defaultValue={issue?.costImpactCents != null ? f.decimal(issue.costImpactCents / 100) : ""}
          />
        </Field>
        <Field>
          <Label htmlFor={id("days")}>
            {t("scheduleImpact")} <Optional />
          </Label>
          <Input
            id={id("days")}
            name="days"
            type="number"
            step={1}
            className="num"
            placeholder={t("daysPlaceholder")}
            defaultValue={issue?.scheduleImpactDays ?? ""}
          />
        </Field>
      </div>

      <Field>
        <Label htmlFor={id("files")}>{t("files")}</Label>
        {issue && issue.files.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]" aria-label={t("currentFiles")}>
            {issue.files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-2 rounded-md bg-raise px-2.5 py-1">
                {fileUrl ? (
                  <a href={fileUrl(file)} target="_blank" rel="noreferrer" className="truncate font-medium text-info hover:underline">
                    {file.filename}
                  </a>
                ) : (
                  <span className="truncate">{file.filename}</span>
                )}
                {onDeleteFile && (
                  <Button type="button" variant="ghost-destructive" size="icon-sm" disabled={pending} onClick={() => onDeleteFile(file)} aria-label={t("deleteFile", { name: file.filename })}>
                    <X aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Input id={id("files")} type="file" multiple accept={Object.keys(ISSUE_FILE_TYPES).map((e) => `.${e}`).join(",")} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        <FieldDescription>{t("filesHint")}</FieldDescription>
      </Field>

      <Field>
        <Label htmlFor={id("status")}>{t("status")}</Label>
        <NativeSelect id={id("status")} name="status" defaultValue={issue?.status ?? "pending"}>
          {ISSUE_STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {ts(status)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <p className="text-[12px] text-muted-foreground">{t("note")}</p>
      <FormError namespace="construction.issues.errors" error={localError ?? error} />
      {progress && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("uploading", { done: progress.done, total: progress.total })}
        </p>
      )}
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </FormActions>
    </form>
  );
}

function Optional() {
  const t = useTranslations("construction.issues");
  return <span className="text-[12px] font-normal text-muted-foreground">{t("optional")}</span>;
}
