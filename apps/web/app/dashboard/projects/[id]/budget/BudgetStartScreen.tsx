"use client";

// Container for the Budget tab before there is a budget: the documents, the
// AI run and its progress. The only part that knows about server actions;
// the views in ../components/budget take props only.

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ACTIVE_GENERATION_STATUSES, type BudgetGeneration, type BudgetInput, type ProjectDocument } from "@repo/core/contract";
import { cancelGenerationAction, getGenerationAction, startGenerationAction } from "../../../../actions/budget";
import {
  type DocumentsState,
  budgetInputUploadAction,
  deleteProjectDocumentAction,
  markBudgetInputAction,
  registerBudgetInputAction,
} from "../../../../actions/documents";
import FormError from "../../../components/FormError";
import { OpenProjectLink } from "../components/budget/BudgetFrame";
import GenerationView from "../components/budget/GenerationView";
import StartView, { type GenerateInput } from "../components/budget/StartView";
import TabHeader from "../components/TabHeader";
import { useObraAction } from "../components/obra/useObraAction";

const POLL_MS = 3_000;
const isActive = (generation: BudgetGeneration | null) => generation !== null && ACTIVE_GENERATION_STATUSES.includes(generation.status);

export default function BudgetStartScreen({
  projectId,
  projectRef,
  generation: initial,
  canManage,
  inputs,
  documents,
}: {
  projectId: string;
  projectRef: string;
  generation: BudgetGeneration | null;
  canManage: boolean;
  inputs: ProjectDocument[];
  documents: ProjectDocument[];
}) {
  const t = useTranslations("budget");
  const router = useRouter();
  const { state, pending, run } = useObraAction();
  const docs = useObraAction<DocumentsState>();
  // The page keys this screen by the run and its status: a new one starts fresh.
  const [generation, setGeneration] = useState(initial);
  const [uploading, setUploading] = useState<Partial<Record<BudgetInput, number>>>({});
  const [uploadError, setUploadError] = useState<string>();
  const active = isActive(generation);
  const generationId = generation?.id;

  // While the AI works, follow its progress; once it stops, show the result.
  useEffect(() => {
    if (!active || !generationId) return;
    const timer = setInterval(async () => {
      const next = await getGenerationAction(projectId, generationId);
      if (!next) return;
      setGeneration(next);
      if (!isActive(next)) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, generationId, projectId, router]);

  async function uploadInput(kind: BudgetInput, file: File) {
    setUploadError(undefined);
    setUploading((current) => ({ ...current, [kind]: 0 }));
    try {
      const { pathname, error } = await budgetInputUploadAction(projectId, file.name);
      if (!pathname) throw new Error(error ?? "invalid_file_type");
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: `/api/v1/projects/${projectId}/documents/uploads`,
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setUploading((current) => ({ ...current, [kind]: Math.round(percentage) })),
      });
      const result = await registerBudgetInputAction(projectId, { pathname, budgetInput: kind, filename: file.name });
      if (result?.error) throw new Error(result.error);
      router.refresh();
    } catch (error) {
      setUploadError(error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "upload_failed");
    } finally {
      setUploading((current) => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
    }
  }

  function generate(input: GenerateInput) {
    run(() => startGenerationAction(projectId, { ...input, documentIds: inputs.map((d) => d.id) }), () => router.refresh());
  }

  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={active ? t("start.generatingSummary") : t("start.summary")}
        action={<OpenProjectLink projectId={projectId} />}
      />
      <FormError namespace="budget.start.errors" error={uploadError ?? docs.state?.error} />
      {active && generation ? (
        <GenerationView
          generation={generation}
          pending={pending}
          onCancel={canManage ? () => run(() => cancelGenerationAction(projectId, generation.id), () => router.refresh()) : undefined}
        />
      ) : (
        <StartView
          inputs={inputs}
          documents={documents.filter((d) => !d.budgetInput && !d.budgetPdf)}
          uploading={uploading}
          failed={generation?.status === "failed" ? generation : null}
          pending={pending || docs.pending}
          error={state?.error}
          fileUrl={(doc) => `/api/v1/projects/${projectId}/documents/${doc.id}`}
          onUpload={canManage ? uploadInput : undefined}
          onChoose={canManage ? (kind, documentId) => docs.run(() => markBudgetInputAction(projectId, documentId, kind)) : undefined}
          onRemove={canManage ? (doc) => docs.run(() => deleteProjectDocumentAction(projectId, doc.id)) : undefined}
          onGenerate={canManage ? generate : undefined}
        />
      )}
    </div>
  );
}
