import styles from "./TabHeader.module.css";

/** Presentational: heading of a project tab, with an optional action on the right. */
export default function TabHeader({
  projectRef,
  title,
  summary,
  action,
}: {
  projectRef: string;
  title: string;
  summary: string;
  action?: React.ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.ref}>{projectRef}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.summary}>{summary}</p>
      </div>
      {action}
    </header>
  );
}
