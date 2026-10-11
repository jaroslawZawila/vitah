import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The portal's surface: a bordered white panel with a soft shadow. Use `Card` for a `div`, or
 * `cardVariants()` on another element (a `form`, `section`, `article`) to keep its semantics.
 */
const cardVariants = cva(
  "flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground shadow-card",
  {
    variants: {
      size: {
        default: "gap-3.5 p-[18px]",
        /** A KPI tile. */
        kpi: "gap-1 px-[18px] py-4",
        /** Wraps a table or list whose rows bring their own vertical padding. */
        list: "px-[18px] py-2.5",
        /** No padding: content (e.g. an image) runs to the edges. */
        flush: "overflow-hidden",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Card({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div data-slot="card" className={cn(cardVariants({ size }), className)} {...props} />
  )
}

export { Card, cardVariants }
