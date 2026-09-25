// The app's single design entry point. Colors come from the shared ViTAH
// brand tokens; the scales below cover everything else.
import type { TextStyle } from "react-native";
import { colors } from "@repo/brand-tokens";

export { colors };

/** 4-point grid. Screen edge padding is `lg`. */
export const spacing = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  md: 8,
  /** Tiles, e.g. Home's shortcuts. */
  lg: 12,
  /** Cards. */
  xl: 16,
} as const;

/** "Minimalista de lujo": light weights, wide tracking on labels. */
export const type = {
  display: { fontSize: 30, fontWeight: "300", color: colors.blancoCalido },
  title: { fontSize: 22, fontWeight: "300", color: colors.blancoCalido },
  body: { fontSize: 17, fontWeight: "400", color: colors.blancoCalido },
  /** List rows and card text (15). */
  row: { fontSize: 15, fontWeight: "400", color: colors.blancoCalido },
  subhead: { fontSize: 15, fontWeight: "400", color: colors.muted },
  label: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.muted,
  },
} as const satisfies Record<string, TextStyle>;

/** A card: "Card" in doc/mobile-app-design/README.md. */
export const card = {
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.surfaceBorder,
  borderRadius: radius.xl,
} as const;
