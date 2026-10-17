"use client";

// Container for Obra › Incidencias: the only part of it that knows about
// server actions. `IssueEditor` is also used in a dialog by Avance and by a
// chapter's page. The views in ../../components/construction take props only.

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { IssueFile, IssueKind, ObraError, ObraIssue } from "@repo/core/contract";
import {
  addIssueFileAction,
  createIssueAction,
  deleteIssueFileAction,
  updateIssueAction,
} from "../../../../../actions/construction";
import EmptyState from "../../components/EmptyState";
import { SleepingCamera } from "../../components/illustrations";
import { FilterSelect } from "../../components/construction/Filters";
import { IssueCard, IssueForm, type IssueValues } from "../../components/construction/IssueViews";
import ObraFrame, { type ObraHeader } from "../../components/construction/ObraFrame";
import Segmented from "../../components/construction/Segmented";

/** An issue's attachment, served by /api/v1 with the session. */
export const issueFileUrl = (projectId: string, issueId: string, fileId: string) =>
  `/api/v1/projects/${projectId}/obra/issues/${issueId}/files/${fileId}`;

type Chapters = { code: string; name: string }[];

/**
 * Saves a record (creating or updating it), then uploads its new
 * attachments one by one. If an upload fails after a record was created, the
 * next save updates that record instead of creating another.
 */
export function IssueEditor({
  projectId,
  chapters,
  today,
  issue,
  chapterCode,
  onDone,
  bare,
  className,
}: {
  projectId: string;
  chapters: Chapters;
  today: string;
  issue?: ObraIssue | null;
  chapterCode?: string;
  /** After saving or cancelling. */
  onDone: () => void;
  bare?: boolean;
  className?: string;
}) {
  const t = useTranslations("construction.issues");
  const [error, setError] = useState<ObraError | undefined>();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const created = useRef<string | null>(null);
  // Attachments already up, not sent again when saving after a failed one.
  const uploaded = useRef(new Set<File>());

  function save(values: IssueValues, files: File[]) {
    startTransition(async () => {
      setError(undefined);
      const input = { ...values, partyName: values.partyName || null };
      let id = issue?.id ?? created.current;
      if (id) {
        const state = await updateIssueAction(projectId, id, input);
        if (!state?.success) return setError(state?.error);
      } else {
        const state = await createIssueAction(projectId, input);
        if (!state?.success || !state.issueId) return setError(state?.error);
        id = state.issueId;
      }
      created.current = id;
      const toUpload = files.filter((file) => !uploaded.current.has(file));
      for (const [index, file] of toUpload.entries()) {
        setProgress({ done: index + 1, total: toUpload.length });
        const data = new FormData();
        data.set("file", file);
        const upload = await addIssueFileAction(projectId, id, null, data);
        if (!upload?.success) {
          setProgress(null);
          setError(upload?.error);
          return;
        }
        uploaded.current.add(file);
      }
      setProgress(null);
      onDone();
    });
  }

  function deleteFile(file: IssueFile) {
    if (!issue || !confirm(t("confirmDeleteFile", { name: file.filename }))) return;
    startTransition(async () => {
      const state = await deleteIssueFileAction(projectId, issue.id, file.id);
      setError(state?.success ? undefined : state?.error);
    });
  }

  return (
    <IssueForm
      issue={issue}
      chapters={chapters}
      today={today}
      chapterCode={chapterCode}
      pending={pending}
      progress={progress}
      error={error}
      onSubmit={save}
      onCancel={onDone}
      onDeleteFile={issue ? deleteFile : undefined}
      fileUrl={issue ? (file) => issueFileUrl(projectId, issue.id, file.id) : undefined}
      bare={bare}
      className={className}
    />
  );
}

type KindFilter = "all" | IssueKind;
type StatusFilter = "all" | "open" | ObraIssue["status"];

/** The issues and changes of the works, filtered here, with the form beside them. */
export default function IssuesScreen({
  projectId,
  header,
  issues,
  chapters,
  today,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  issues: ObraIssue[];
  chapters: Chapters;
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("construction.issues");
  const tf = useTranslations("construction.filters");
  const tk = useTranslations("construction.issueKind");
  const ts = useTranslations("construction.issueStatus");
  const [kind, setKind] = useState<KindFilter>("all");
  const [chapter, setChapter] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped after each save so the form starts afresh.
  const [formKey, setFormKey] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const names = new Map(chapters.map((c) => [c.code, c.name]));
  const editingIssue = issues.find((i) => i.id === editing) ?? null;

  const shown = issues.filter(
    (i) =>
      (kind === "all" || i.kind === kind) &&
      (chapter === "all" || i.chapterCode === chapter) &&
      (status === "all" || (status === "open" ? i.status !== "resolved" : i.status === status)),
  );
  const count = (k: IssueKind) => issues.filter((i) => i.kind === k).length;

  function edit(issue: ObraIssue) {
    setEditing(issue.id);
    setFormKey((k) => k + 1);
    formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return (
    <ObraFrame projectId={projectId} header={header} current="issues" title={t("title")} description={t("description")}>
      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label={t("records")} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented
              label={t("kind")}
              value={kind}
              onChange={setKind}
              options={[
                { key: "all", label: tf("all"), count: issues.length },
                { key: "issue", label: tk("plural.issue"), count: count("issue") },
                { key: "change", label: tk("plural.change"), count: count("change") },
              ]}
            />
            <FilterSelect
              id="issues-chapter"
              label={tf("chapter")}
              value={chapter}
              onChange={setChapter}
              options={[{ value: "all", label: tf("all") }, ...chapters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))]}
            />
            <FilterSelect
              id="issues-status"
              label={t("status")}
              value={status}
              onChange={(value) => setStatus(value as StatusFilter)}
              options={[
                { value: "all", label: tf("all") },
                { value: "open", label: t("open") },
                ...(["pending", "review", "resolved"] as const).map((s) => ({ value: s, label: ts(s) })),
              ]}
            />
          </div>

          {issues.length === 0 ? (
            <EmptyState illustration={<SleepingCamera />} title={t("emptyTitle")} text={t("emptyText")} />
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-muted-foreground">{t("noMatch")}</p>
          ) : (
            shown.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                chapterName={names.get(issue.chapterCode)}
                fileUrl={(i, file) => issueFileUrl(projectId, i.id, file.id)}
                onEdit={canManage ? () => edit(issue) : undefined}
              />
            ))
          )}
        </section>

        {canManage && (
          <div ref={formRef} className="scroll-mt-4 lg:sticky lg:top-4">
            <IssueEditor
              key={`${editing ?? "new"}-${formKey}`}
              projectId={projectId}
              chapters={chapters}
              today={today}
              issue={editingIssue}
              onDone={() => {
                setEditing(null);
                setFormKey((k) => k + 1);
              }}
            />
          </div>
        )}
      </div>
    </ObraFrame>
  );
}
