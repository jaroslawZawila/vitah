import styles from "./EmptyState.module.css";

/** Presentational: a friendly placeholder for a tab with nothing in it yet. */
export default function EmptyState({
  illustration,
  title,
  text,
}: {
  illustration: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className={styles.empty}>
      {illustration}
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.text}>{text}</p>
    </div>
  );
}
