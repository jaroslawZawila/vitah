"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type {
  ProjectOption,
  SubcontractorAssignment,
  SubcontractorError,
  SubcontractorKind,
} from "@repo/core/contract";
import FormError from "../../../components/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FormActions } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { DocStateBadge } from "../Badges";
import AssignmentFields from "../fields/AssignmentFields";
import { EMPTY_ASSIGNMENT, type AssignmentValues } from "../fields/draft";
import { useDates, useRequirementName } from "../display";

/**
 * Presentational: the obras a company works on, and the form to put it on one
 * or change what it does there. `onSave` resolves true once saved.
 */
export default function ObrasTab({
  assignments,
  projects,
  kind,
  canManage,
  busy,
  error,
  onSave,
  onRemove,
}: {
  assignments: SubcontractorAssignment[];
  projects: ProjectOption[];
  kind: SubcontractorKind;
  canManage: boolean;
  busy: boolean;
  error?: SubcontractorError;
  onSave: (projectId: string, values: AssignmentValues) => Promise<boolean>;
  onRemove: (assignment: SubcontractorAssignment) => void;
}) {
  const t = useTranslations("subcontractors.company.obras");
  const name = useRequirementName();
  const { date } = useDates();
  // "new", the project id of the assignment being edited, or nothing.
  const [editing, setEditing] = useState<string | null>(null);
  const chapterName = (projectId: string, code: string) =>
    projects.find((p) => p.id === projectId)?.chapters.find((c) => c.code === code)?.name;
  const unassigned = projects.filter((p) => !assignments.some((a) => a.projectId === p.id));

  async function save(projectId: string, values: AssignmentValues) {
    if (await onSave(projectId, values)) setEditing(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {assignments.length === 0 && editing !== "new" && (
        <p className={cn(cardVariants(), "text-center text-[13.5px] text-muted-foreground")}>{t("empty")}</p>
      )}
      {assignments.map((a) =>
        editing === a.projectId ? (
          <AssignmentForm
            key={a.projectId}
            title={t("editTitle", { ref: a.projectRef })}
            projects={projects}
            assignment={a}
            busy={busy}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <section key={a.projectId} className={cardVariants()} aria-label={a.projectRef}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="eyebrow">{a.projectRef}</p>
                <h2>{a.projectAddress}</h2>
              </div>
              {canManage && (
                <div className="flex gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(a.projectId)}>
                    {t("edit")}
                  </Button>
                  <Button type="button" variant="ghost-destructive" size="sm" disabled={busy} onClick={() => onRemove(a)}>
                    {t("remove")}
                  </Button>
                </div>
              )}
            </div>
            <dl className="m-0 grid grid-cols-[minmax(120px,32%)_1fr] gap-x-3.5 gap-y-2.5 text-[13.5px]">
              <dt className="text-muted-foreground">{t("chapters")}</dt>
              <dd className="m-0 flex flex-wrap gap-1.5">
                {a.chapterCodes.length === 0
                  ? t("noChapters")
                  : a.chapterCodes.map((code) => (
                      <Badge key={code} variant="outline">
                        <span className="num">{code}</span> {chapterName(a.projectId, code)}
                      </Badge>
                    ))}
              </dd>
              <dt className="text-muted-foreground">{t("dates")}</dt>
              <dd className="m-0 num">
                {date(a.plannedStart)} → {date(a.plannedEnd)}
              </dd>
              <dt className="text-muted-foreground">{t("pss")}</dt>
              <dd className="m-0 flex flex-wrap items-center gap-1.5">
                <DocStateBadge state={a.pssAdhesion.state} daysLeft={a.pssAdhesion.daysLeft} />
                <span className="text-[12.5px] text-muted-foreground">{name("adhesion_pss", kind)}</span>
              </dd>
              <dt className="text-muted-foreground">{t("book")}</dt>
              <dd className="m-0 flex flex-wrap items-center gap-1.5">
                {a.bookOrder !== null && a.bookDate ? (
                  <span>{t("bookEntry", { order: a.bookOrder, date: date(a.bookDate) })}</span>
                ) : (
                  <Badge variant="yel">{t("noBook")}</Badge>
                )}
                <Badge variant={a.cssInformed ? "good" : "outline"}>{a.cssInformed ? t("cssYes") : t("cssNo")}</Badge>
              </dd>
              <dt className="text-muted-foreground">{t("workersLabel")}</dt>
              <dd className="m-0">{t("workersAccess", a.workers)}</dd>
            </dl>
          </section>
        ),
      )}
      {canManage &&
        (editing === "new" ? (
          <AssignmentForm
            title={t("assignTitle")}
            projects={unassigned}
            busy={busy}
            error={error}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : (
          unassigned.length > 0 && (
            <div>
              <Button type="button" variant="outline" onClick={() => setEditing("new")}>
                <Plus aria-hidden />
                {t("assignTitle")}
              </Button>
            </div>
          )
        ))}
    </div>
  );
}

/** Presentational: an assignment's obra, chapters, dates and book entry. */
export function AssignmentForm({
  title,
  projects,
  assignment,
  busy,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  projects: ProjectOption[];
  /** The assignment being edited; its obra can't change. */
  assignment?: SubcontractorAssignment;
  busy: boolean;
  error?: SubcontractorError;
  onSave: (projectId: string, values: AssignmentValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("subcontractors.company.obras");
  const [projectId, setProjectId] = useState(assignment?.projectId ?? "");
  const [values, setValues] = useState<AssignmentValues>(
    assignment
      ? {
          chapterCodes: assignment.chapterCodes,
          plannedStart: assignment.plannedStart ?? "",
          plannedEnd: assignment.plannedEnd ?? "",
          bookOrder: assignment.bookOrder?.toString() ?? "",
          bookDate: assignment.bookDate ?? "",
          cssInformed: assignment.cssInformed,
        }
      : EMPTY_ASSIGNMENT,
  );
  const set = (patch: Partial<AssignmentValues>) => setValues((v) => ({ ...v, ...patch }));
  const chapters = projects.find((p) => p.id === projectId)?.chapters ?? [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (projectId) onSave(projectId, values);
  }

  return (
    <form onSubmit={submit} className={cardVariants()} aria-label={title}>
      <h2>{title}</h2>
      {!assignment && (
        <Field>
          <Label htmlFor="assignment-project">{t("project")}</Label>
          <NativeSelect
            id="assignment-project"
            required
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              set({ chapterCodes: [] });
            }}
          >
            <NativeSelectOption value="" disabled>
              {t("chooseProject")}
            </NativeSelectOption>
            {projects.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.ref} · {p.address}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      {projectId && <AssignmentFields idPrefix="assignment" chapters={chapters} values={values} onChange={set} />}
      <FormError namespace="subcontractors.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy || !projectId}>
          {busy ? t("saving") : t("save")}
        </Button>
      </FormActions>
    </form>
  );
}
