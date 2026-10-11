import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.25 overflow-hidden rounded-full border border-transparent px-2.25 py-0.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-brand-soft text-brand-ink",
        secondary: "bg-foreground text-background",
        outline: "border-border bg-raise text-muted-foreground",
        good: "bg-good-soft text-good",
        yel: "bg-yel-soft text-yel",
        warn: "bg-warn-soft text-warn",
        destructive: "bg-bad-soft text-bad",
        info: "bg-info-soft text-info",
        ghost: "text-muted-foreground hover:bg-raise",
        link: "text-info underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
