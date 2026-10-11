"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ProjectDetail } from "../../../../actions/projects";
import { updateProject, deleteProject } from "../../../../actions/projects";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Dates are calendar dates stored at UTC midnight. */
function toInputDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** `canEdit`: admins and managers; `canDelete`: admins only (as enforced in core). */
export default function ProjectHeader({
  project,
  canEdit,
  canDelete,
}: {
  project: ProjectDetail;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("projectDetailPage.header");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    address: project.address,
    startDate: toInputDate(project.startDate),
    completionDate: toInputDate(project.completionDate),
  });

  function formatDate(date: Date | null) {
    return date ? format.dateTime(date, { dateStyle: "long", timeZone: "UTC" }) : t("notSet");
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateProject(project.id, form);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setEditing(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      await deleteProject(project.id);
      router.push("/dashboard/projects");
    });
  }

  if (editing) {
    return (
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <Label htmlFor="project-address">{t("address")}</Label>
          <Input
            id="project-address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
        <Field>
          <Label htmlFor="project-start">{t("startDate")}</Label>
          <Input
            id="project-start"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </Field>
        <Field>
          <Label htmlFor="project-completion">{t("completionDate")}</Label>
          <Input
            id="project-completion"
            type="date"
            value={form.completionDate}
            onChange={(e) => setForm({ ...form, completionDate: e.target.value })}
          />
        </Field>
        {error && (
          <FormMessage role="alert" className="sm:col-span-2">
            {t(`errors.${error}`)}
          </FormMessage>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
          {canDelete && (
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              onClick={handleDelete}
              disabled={isPending}
            >
              {t("delete")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            {t("cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {t("save")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-heading text-[26px] leading-[1.05] font-bold tracking-[0.01em] text-brand-ink">
            {project.ref}
          </div>
          <div className="mt-1 text-[13.5px] wrap-anywhere text-muted-foreground">
            {project.address}
          </div>
        </div>
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setEditing(true)}
          >
            {t("edit")}
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3.5 border-t pt-3.5 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
        <div className="flex flex-col gap-1">
          <dt className="eyebrow">{t("startDate")}</dt>
          <dd className="text-[14px] font-semibold">{formatDate(project.startDate)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="eyebrow">{t("completionDate")}</dt>
          <dd className="text-[14px] font-semibold">{formatDate(project.completionDate)}</dd>
        </div>
      </dl>
    </Card>
  );
}
