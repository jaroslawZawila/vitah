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
    <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">{projectRef}</p>
        <h1 className="mt-1">{title}</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{summary}</p>
      </div>
      {action}
    </header>
  );
}
