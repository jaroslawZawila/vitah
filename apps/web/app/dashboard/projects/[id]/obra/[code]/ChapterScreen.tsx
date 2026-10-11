"use client";

// Container for a chapter's site control: the only part that knows about
// server actions. The views in ../../components take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, Hito, ProjectPhoto } from "@repo/core/contract";
import { progressOf } from "@repo/core/obra-calc";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { saveProgressAction } from "../../../../../actions/obra";
import FormError from "../../../../components/FormError";
import Modal from "../../components/Modal";
import { cardHead, muted, textLink } from "../../components/obra/classes";
import { useObraFormat } from "../../components/obra/format";
import HitoReadiness from "../../components/obra/HitoReadiness";
import PhotoStrip from "../../components/obra/PhotoStrip";
import Kpi from "../../components/obra/Kpi";
import ProgressTable from "../../components/obra/ProgressTable";
import { useObraAction } from "../../components/obra/useObraAction";
import { projectPhotoUrl } from "../../components/photoUrl";
import TabHeader from "../../components/TabHeader";
import { UploadPhoto } from "../../photos/PhotosScreen";

/** P-Capitulo: record how much of each line of a chapter is built. */
export default function ChapterScreen({
  projectId,
  projectRef,
  chapter,
  hito,
  photos,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  chapter: BudgetChapter;
  hito: Hito | null;
  photos: ProjectPhoto[];
  canManage: boolean;
}) {
  const t = useTranslations("obra.chapter");
  const f = useObraFormat();
  const base = `/dashboard/projects/${projectId}`;
  const [values, setValues] = useState<Record<string, number>>({});
  const { state, pending: saving, run } = useObraAction();
  const [uploadOpen, setUploadOpen] = useState(false);

  const edited = chapter.lines.map((line) => ({ ...line, executedPct: values[line.id] ?? line.executedPct }));
  const progress = progressOf(edited);
  const changes = edited.filter((line, i) => line.executedPct !== chapter.lines[i]!.executedPct);

  const save = () =>
    run(
      () => saveProgressAction(projectId, changes.map(({ id, executedPct }) => ({ id, executedPct }))),
      () => setValues({}),
    );

  const summary = [
    t("summary", {
      amount: f.money(chapter.totalCents),
      share: f.share(chapter.shareBp),
      lines: chapter.lines.length,
    }),
    hito && t("closedBy", { code: hito.code }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <Link href={`${base}/obra`} className={cn("w-fit text-[13px]", textLink)}>
        ← {t("back")}
      </Link>
      <TabHeader
        projectRef={t("label", { ref: projectRef, code: chapter.code })}
        title={chapter.name}
        summary={summary}
        action={
          canManage && (
            <Button type="button" onClick={save} disabled={saving || changes.length === 0}>
              {saving ? t("saving") : t("save")}
            </Button>
          )
        }
      />
      <FormError namespace="obra.errors" error={state?.error} />
      {state?.success && changes.length === 0 && (
        <FormMessage role="status" tone="success">
          {t("saved")}
        </FormMessage>
      )}

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className={cardVariants()}>
          <div className={cardHead}>
            <h2>{t("lines")}</h2>
          </div>
          <ProgressTable
            code={chapter.code}
            lines={edited}
            progress={progress}
            onChange={(id, pct) => setValues((v) => ({ ...v, [id]: pct }))}
            disabled={!canManage}
          />
          <p className="rounded-lg bg-raise px-[13px] py-2.5 text-[13px] text-muted-foreground">{t("help")}</p>
        </section>

        <aside className="flex min-w-0 flex-col gap-5">
          <Kpi
            highlight
            label={t("progressCard")}
            value={`${progress.progressPct} %`}
            pct={progress.progressPct}
            hints={[
              t("executedOf", {
                executed: f.money(progress.executedCents),
                total: f.money(progress.totalCents),
              }),
            ]}
          />

          {hito && <HitoReadiness hito={hito} href={`${base}/payments/${hito.id}`} />}

          <section className={cardVariants()}>
            <div className={cn(cardHead, "items-center")}>
              <span className="eyebrow">{t("photos", { count: photos.length })}</span>
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                  {t("addPhotos")}
                </Button>
              )}
            </div>
            {photos.length > 0 ? (
              <PhotoStrip
                photos={photos}
                thumbUrl={(photo) => projectPhotoUrl(projectId, photo.id, "thumb")}
              />
            ) : (
              <span className={muted}>{t("noPhotos")}</span>
            )}
            <span className={muted}>{t("photosHint")}</span>
          </section>
        </aside>
      </div>

      {canManage && (
        <Modal open={uploadOpen} onOpenChange={setUploadOpen} title={t("addPhotos")}>
          <UploadPhoto projectId={projectId} chapterCode={chapter.code} onDone={() => setUploadOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
