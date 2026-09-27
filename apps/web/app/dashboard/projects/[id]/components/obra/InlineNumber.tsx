"use client";

import { useState } from "react";
import styles from "./obra.module.css";

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
    <input
      type="text"
      inputMode="decimal"
      className={styles.input}
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
