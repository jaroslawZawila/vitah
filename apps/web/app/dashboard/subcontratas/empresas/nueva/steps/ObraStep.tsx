"use client";

import { useTranslations } from "next-intl";
import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import SummaryList from "../../../../components/wizard/SummaryList";
import AssignmentFields from "../../../components/fields/AssignmentFields";
import { useDates, useRequirementBasis, useRequirementName } from "../../../components/display";
import { EMPTY_OBRA, type CompanyFlowDraft, type CompanyFlowOptions, type CompanyStepProps, type ObraDraft } from "../draft";
import FileSlot from "./FileSlot";

/** Step 4 (optional): the obra the company starts on, its chapters and the obra's own documents. */
export function ObraStep({ draft, onChange, options }: CompanyStepProps) {
  const t = useTranslations("subcontractors.wizard.obra");
  const name = useRequirementName();
  const basis = useRequirementBasis();
  const { obra } = draft;
  const project = options.projects.find((p) => p.id === obra.projectId);
  const update = (patch: Partial<ObraDraft>) => onChange({ obra: { ...obra, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">{t("intro")}</p>
      <Field>
        <Label htmlFor="obra-project">{t("project")}</Label>
        <NativeSelect
          id="obra-project"
          value={obra.projectId}
          // A different obra has other chapters: start over.
          onChange={(e) => onChange({ obra: { ...EMPTY_OBRA, projectId: e.target.value } })}
        >
          <NativeSelectOption value="">{t("noProject")}</NativeSelectOption>
          {options.projects.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.ref} · {p.address}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      {project && (
        <>
          <section className="border-t pt-4">
            <AssignmentFields idPrefix="obra" chapters={project.chapters} values={obra} onChange={update} />
          </section>
          <section className="flex flex-col gap-3 border-t pt-4">
            <h3>{t("documents")}</h3>
            <Field>
              <Label htmlFor="obra-pss">{name("adhesion_pss")}</Label>
              <FileSlot id="obra-pss" label={name("adhesion_pss")} file={obra.pssFile} onChange={(pssFile) => update({ pssFile })} />
              <FieldDescription>
                {basis("adhesion_pss")} · <span className="num">adhesion_pss</span>
              </FieldDescription>
            </Field>
          </section>
        </>
      )}
    </div>
  );
}

export function ObraSummary({ draft, options }: { draft: CompanyFlowDraft; options: CompanyFlowOptions }) {
  const t = useTranslations("subcontractors.wizard.obra");
  const { date } = useDates();
  const { obra } = draft;
  const project = options.projects.find((p) => p.id === obra.projectId);
  if (!project) return <p className="m-0 text-sm text-muted-foreground">{t("noProject")}</p>;
  return (
    <SummaryList
      items={[
        { label: t("project"), value: `${project.ref} · ${project.address}` },
        { label: t("chapters"), value: obra.chapterCodes.join(", ") },
        {
          label: t("dates"),
          value: obra.plannedStart || obra.plannedEnd ? `${date(obra.plannedStart)} → ${date(obra.plannedEnd)}` : null,
        },
        {
          label: t("book"),
          value: obra.bookOrder ? t("bookSummary", { order: obra.bookOrder, date: date(obra.bookDate) }) : null,
        },
        { label: t("pss"), value: obra.pssFile?.name ?? null },
      ]}
    />
  );
}
