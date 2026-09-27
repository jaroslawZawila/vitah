import Link from "next/link";
import styles from "./obra.module.css";
import ProgressBar from "./ProgressBar";

/** Presentational: a key figure card with an optional bar and hint lines. */
export default function Kpi({
  label,
  value,
  pct,
  hints = [],
  href,
}: {
  label: string;
  value: React.ReactNode;
  pct?: number;
  hints?: React.ReactNode[];
  href?: string;
}) {
  const body = (
    <>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {pct !== undefined && <ProgressBar pct={pct} />}
      {hints.map((hint, index) => (
        <span key={index} className={styles.kpiHint}>
          {hint}
        </span>
      ))}
    </>
  );
  return href ? (
    <Link href={href} className={`${styles.card} ${styles.kpi} ${styles.kpiLink}`}>
      {body}
    </Link>
  ) : (
    <div className={`${styles.card} ${styles.kpi}`}>{body}</div>
  );
}
