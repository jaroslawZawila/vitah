"use client";

import { useTranslations } from "next-intl";
import type { HitoStatus, ProgressStatus } from "@repo/core/contract";
import styles from "./obra.module.css";

const TONE: Record<ProgressStatus | HitoStatus, string> = {
  pending: styles.pillPending!,
  active: styles.pillActive!,
  ready: styles.pillActive!,
  signed: styles.pillDark!,
  invoiced: styles.pillDark!,
  done: styles.pillDone!,
  paid: styles.pillDone!,
};

/** Presentational: the status of a chapter ("status") or a hito ("hitoStatus"). */
export default function StatusPill({
  status,
  kind = "status",
}: {
  status: ProgressStatus | HitoStatus;
  kind?: "status" | "hitoStatus";
}) {
  const t = useTranslations(`obra.${kind}`);
  return <span className={`${styles.pill} ${TONE[status]}`}>{t(status)}</span>;
}
