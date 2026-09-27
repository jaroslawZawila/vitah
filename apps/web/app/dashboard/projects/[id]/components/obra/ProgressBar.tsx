import styles from "./obra.module.css";

/** Presentational: a thin progress bar (decorative; show the % as text beside it). */
export default function ProgressBar({ pct }: { pct: number }) {
  return (
    <span className={styles.bar} aria-hidden>
      <span className={styles.barFill} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}
