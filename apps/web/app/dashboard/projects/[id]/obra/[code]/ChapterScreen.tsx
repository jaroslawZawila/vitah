"use client";

// Container for a chapter's site control: the only part that knows about
// server actions. The views in ../../components take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, Hito, ProjectPhoto } from "@repo/core/contract";
import { progressOf } from "@repo/core/obra-calc";
import { saveProgressAction } from "../../../../../actions/obra";
import FormError from "../../components/FormError";
import Modal from "../../components/Modal";
import { useObraFormat } from "../../components/obra/format";
import HitoReadiness from "../../components/obra/HitoReadiness";
import styles from "../../components/obra/obra.module.css";
import PhotoStrip from "../../components/obra/PhotoStrip";
import ProgressBar from "../../components/obra/ProgressBar";
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
    <div className={styles.stack}>
      <Link href={`${base}/obra`} className={styles.link}>
        ← {t("back")}
      </Link>
      <TabHeader
        projectRef={t("label", { ref: projectRef, code: chapter.code })}
        title={chapter.name}
        summary={summary}
        action={
          canManage && (
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={save}
              disabled={saving || changes.length === 0}
            >
              {saving ? t("saving") : t("save")}
            </button>
          )
        }
      />
      <FormError namespace="obra.errors" error={state?.error} />
      {state?.success && changes.length === 0 && (
        <p role="status" className={styles.good}>
          {t("saved")}
        </p>
      )}

      <div className={styles.split}>
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>{t("lines")}</h2>
          </div>
          <ProgressTable
            code={chapter.code}
            lines={edited}
            progress={progress}
            onChange={(id, pct) => setValues((v) => ({ ...v, [id]: pct }))}
            disabled={!canManage}
          />
          <p className={styles.note}>{t("help")}</p>
        </section>

        <aside className={styles.aside}>
          <section className={styles.cardTight}>
            <span className={styles.label}>{t("progressCard")}</span>
            <span className={styles.big}>{progress.progressPct} %</span>
            <ProgressBar pct={progress.progressPct} />
            <span className={styles.muted}>
              {t("executedOf", {
                executed: f.money(progress.executedCents),
                total: f.money(progress.totalCents),
              })}
            </span>
          </section>

          {hito && <HitoReadiness hito={hito} href={`${base}/payments/${hito.id}`} />}

          <section className={styles.cardSnug}>
            <div className={styles.cardHeadFlush}>
              <span className={styles.label}>{t("photos", { count: photos.length })}</span>
              {canManage && (
                <button type="button" className={styles.textButton} onClick={() => setUploadOpen(true)}>
                  {t("addPhotos")}
                </button>
              )}
            </div>
            {photos.length > 0 ? (
              <PhotoStrip
                photos={photos}
                thumbUrl={(photo) => projectPhotoUrl(projectId, photo.id, "thumb")}
              />
            ) : (
              <span className={styles.muted}>{t("noPhotos")}</span>
            )}
            <span className={styles.muted}>{t("photosHint")}</span>
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
