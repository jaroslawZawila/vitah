/** Presentational: label/value pairs for a step summary. */
export default function SummaryList({
  items,
}: {
  items: { label: string; value: string | null }[];
}) {
  return (
    <dl className="m-0 grid gap-3 md:grid-cols-2">
      {items.map(({ label, value }) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="m-0 text-sm wrap-anywhere text-foreground">
            {value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
