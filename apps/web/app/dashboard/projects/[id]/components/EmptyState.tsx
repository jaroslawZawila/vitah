/** Presentational: a friendly placeholder for a tab with nothing in it yet. */
export default function EmptyState({
  illustration,
  title,
  text,
  action,
}: {
  illustration: React.ReactNode;
  title: string;
  text: string;
  /** E.g. the button that fills the tab. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-4 py-[clamp(32px,8vw,64px)] text-center">
      {illustration}
      <h2>{title}</h2>
      <p className="max-w-[36ch] text-[13.5px] text-muted-foreground">{text}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
