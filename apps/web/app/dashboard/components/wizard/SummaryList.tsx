import styles from "./wizard.module.css";

/** Presentational: label/value pairs for a step summary. */
export default function SummaryList({
  items,
}: {
  items: { label: string; value: string | null }[];
}) {
  return (
    <dl className={styles.summary}>
      {items.map(({ label, value }) => (
        <div key={label} className={styles.summaryRow}>
          <dt>{label}</dt>
          <dd>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
