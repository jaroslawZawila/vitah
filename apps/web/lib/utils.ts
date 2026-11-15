import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// `text-meta` is the type scale's 13px step (globals.css): a font size, so it replaces `text-sm`, not a colour.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["meta"] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
