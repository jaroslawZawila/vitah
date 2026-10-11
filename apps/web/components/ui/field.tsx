import * as React from "react"

import { cn } from "@/lib/utils"

/** A form field: a `Label`, then its control, then an optional `FieldDescription`. */
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="field" className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props} />
  )
}

/** A hint under a field. */
function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

/** A form's Cancel / Submit row: stacked (primary on top) on phones, right-aligned from `md`. */
function FormActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-actions"
      className={cn("flex flex-col-reverse gap-2 md:flex-row md:justify-end", className)}
      {...props}
    />
  )
}

/** A form's outcome line. Pass `role="alert"` / `role="status"` as the call site needs. */
function FormMessage({
  className,
  tone = "error",
  ...props
}: React.ComponentProps<"p"> & { tone?: "error" | "success" }) {
  return (
    <p
      data-slot="form-message"
      className={cn(
        "text-[13px]",
        tone === "error" ? "text-destructive" : "text-good",
        className
      )}
      {...props}
    />
  )
}

export { Field, FieldDescription, FormActions, FormMessage }
