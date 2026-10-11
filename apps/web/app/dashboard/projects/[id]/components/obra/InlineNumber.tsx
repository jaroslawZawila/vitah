"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Presentational: a number typed the local way ("1.250,50") that commits on
 * blur or Enter when it changed and parses; otherwise it goes back.
 */
export default function InlineNumber({
  label,
  display,
  parse,
  onCommit,
}: {
  label: string;
  /** The current value as shown. */
  display: string;
  parse: (text: string) => number | null;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(display);

  function commit() {
    const value = parse(text);
    if (value === null) {
      setText(display);
      return;
    }
    if (text !== display) onCommit(value);
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      className="h-8 border-transparent bg-transparent px-1.5 text-right font-mono text-[12.5px] hover:border-border hover:bg-raise focus-visible:bg-raise"
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
