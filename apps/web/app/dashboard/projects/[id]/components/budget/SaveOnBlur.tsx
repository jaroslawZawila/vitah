"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Presentational: a text field that saves itself on blur when it changed
 * (the budget's texts and names). Read-only when `onSave` is omitted.
 */
export default function SaveOnBlur({
  value,
  onSave,
  label,
  multiline = false,
  rows = 3,
  placeholder,
  className,
  invalid,
}: {
  value: string;
  onSave?: (value: string) => void;
  label: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
  /** Marks a field the AI couldn't fill (shown amber). */
  invalid?: boolean;
}) {
  const [text, setText] = useState(value);
  const common = {
    "aria-label": label,
    value: text,
    placeholder,
    readOnly: !onSave,
    onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setText(event.target.value),
    onBlur: () => {
      if (onSave && text.trim() !== value.trim()) onSave(text.trim());
    },
    className: cn(invalid && "border-warn bg-warn-soft", className),
  };
  return multiline ? <Textarea rows={rows} {...common} /> : <Input type="text" {...common} />;
}
