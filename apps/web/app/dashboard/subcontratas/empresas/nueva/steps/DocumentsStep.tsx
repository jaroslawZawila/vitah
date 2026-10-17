"use client";

import { useTranslations } from "next-intl";
import { requirementsFor, type DocumentRequirement } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SummaryList from "../../../../components/wizard/SummaryList";
import { useRequirementBasis, useRequirementName } from "../../../components/display";
import { documentDraft, type CompanyFlowDraft, type CompanyStepProps, type DocumentDraft } from "../draft";
import FileSlot from "./FileSlot";

const REQUIREMENTS = requirementsFor("company");

/** Step 3: the company's documents. Each becomes version 1, awaiting validation. */
export function DocumentsStep({ draft, onChange }: CompanyStepProps) {
  const t = useTranslations("subcontractors.wizard.documents");
  const update = (id: string, patch: Partial<DocumentDraft>) =>
    onChange({ documents: { ...draft.documents, [id]: { ...documentDraft(draft, id), ...patch } } });

  const mandatory = REQUIREMENTS.filter((r) => r.mandatory);
  const optional = REQUIREMENTS.filter((r) => !r.mandatory);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">{t("intro")}</p>
      <section aria-labelledby="documents-mandatory">
        <h3 id="documents-mandatory" className="eyebrow mb-1">
          {t("mandatory", { chosen: mandatory.filter((r) => documentDraft(draft, r.id).file).length, total: mandatory.length })}
        </h3>
        {mandatory.map((req) => (
          <DocumentRow key={req.id} req={req} draft={draft} doc={documentDraft(draft, req.id)} onChange={(patch) => update(req.id, patch)} />
        ))}
      </section>
      <section aria-labelledby="documents-optional">
        <h3 id="documents-optional" className="eyebrow mb-1">
          {t("optional")}
        </h3>
        {optional.map((req) => (
          <DocumentRow key={req.id} req={req} draft={draft} doc={documentDraft(draft, req.id)} onChange={(patch) => update(req.id, patch)} />
        ))}
      </section>
    </div>
  );
}

function DocumentRow({
  req,
  draft,
  doc,
  onChange,
}: {
  req: DocumentRequirement;
  draft: CompanyFlowDraft;
  doc: DocumentDraft;
  onChange: (patch: Partial<DocumentDraft>) => void;
}) {
  const t = useTranslations("subcontractors.wizard.documents");
  const name = useRequirementName()(req.id, draft.kind);
  const basis = useRequirementBasis()(req.id);
  const needsDate = !!req.validityMonths && !!doc.file && !doc.issuedAt && !doc.expiresAt;

  return (
    <div className="flex flex-col gap-2.5 border-t py-3 first-of-type:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground">
            {basis} · <span className="num">{req.id}</span>
          </div>
        </div>
        {doc.notApplicable ? (
          <Badge variant="outline">{t("notApplicable")}</Badge>
        ) : doc.file ? (
          <Badge variant="info">{t("willUpload")}</Badge>
        ) : (
          <Badge variant={req.mandatory ? "yel" : "outline"}>{t("missing")}</Badge>
        )}
      </div>
      {!doc.notApplicable && (
        <div className="grid gap-2.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
          <Field>
            <Label htmlFor={`doc-${req.id}-file`}>{t("file")}</Label>
            <FileSlot id={`doc-${req.id}-file`} label={t("fileFor", { document: name })} file={doc.file} onChange={(file) => onChange({ file })} />
          </Field>
          <Field>
            <Label htmlFor={`doc-${req.id}-issued`}>{t("issuedAt")}</Label>
            <Input
              id={`doc-${req.id}-issued`}
              type="date"
              value={doc.issuedAt}
              aria-invalid={needsDate || undefined}
              onChange={(e) => onChange({ issuedAt: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor={`doc-${req.id}-expires`}>{t("expiresAt")}</Label>
            <Input
              id={`doc-${req.id}-expires`}
              type="date"
              value={doc.expiresAt}
              placeholder={t("automatic")}
              onChange={(e) => onChange({ expiresAt: e.target.value })}
            />
          </Field>
        </div>
      )}
      {needsDate && <p className="m-0 text-xs text-destructive">{t("needsDate")}</p>}
      {!req.mandatory && (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-sm font-medium lg:min-h-9">
            <input
              type="checkbox"
              className="size-[18px] accent-primary"
              checked={doc.notApplicable}
              onChange={(e) => onChange({ notApplicable: e.target.checked, file: e.target.checked ? null : doc.file })}
            />
            {t("markNotApplicable")}
          </label>
          {doc.notApplicable && (
            <Field>
              <Label htmlFor={`doc-${req.id}-reason`}>{t("reason")}</Label>
              <Input
                id={`doc-${req.id}-reason`}
                required
                maxLength={200}
                value={doc.reason}
                onChange={(e) => onChange({ reason: e.target.value })}
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

export function DocumentsSummary({ draft }: { draft: CompanyFlowDraft }) {
  const t = useTranslations("subcontractors.wizard.documents");
  const name = useRequirementName();
  const chosen = REQUIREMENTS.filter((r) => documentDraft(draft, r.id).file).map((r) => name(r.id, draft.kind));
  const notApplicable = REQUIREMENTS.filter((r) => documentDraft(draft, r.id).notApplicable).map((r) =>
    name(r.id, draft.kind),
  );
  return (
    <SummaryList
      items={[
        { label: t("toUpload"), value: chosen.join(", ") },
        { label: t("notApplicable"), value: notApplicable.join(", ") },
      ]}
    />
  );
}
