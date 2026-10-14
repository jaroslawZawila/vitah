"use client";

import { useObraFormat } from "../obra/format";
import InlineNumber from "../obra/InlineNumber";

/** Presentational: a % (stored in basis points) typed in place, committed in % on blur or Enter. */
export default function InlinePct({ label, bp, onCommit }: { label: string; bp: number; onCommit: (pct: number) => void }) {
  const f = useObraFormat();
  return (
    <span className="inline-flex w-[84px] items-center gap-1">
      <InlineNumber key={bp} label={label} display={f.pctInput(bp)} parse={f.parse} onCommit={onCommit} />%
    </span>
  );
}
