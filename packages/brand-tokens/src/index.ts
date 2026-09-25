/**
 * ViTAH brand tokens — shared between web (via CSS vars) and mobile (direct import).
 * Keep in sync with packages/tailwind-config/theme.css and apps/web/app/globals.css.
 */

export const colors = {
  // Core palette
  grafito: "#1e1e1e",
  verdeOliva: "#6b7a4a",
  verdeOlivaHover: "#7d8e58",
  verdeOlivaDark: "#4a5e2c",
  verdeOlivaLight: "#8a9b62",
  blancoCalido: "#e8e7e2",
  verdeOscuro: "#37505a",

  // UI chrome
  muted: "#9a9a94",
  inputBg: "#2a2a2a",
  inputBorder: "#3a3a3a",
  error: "#c75050",

  // Mobile app chrome (doc/mobile-app-design/README.md)
  surface: "#262624",
  surfaceBorder: "#34342f",
  divider: "#2e2e2b",
  chipBorder: "#3c3c37",
  tabBar: "#181817",
  inactive: "#8a8a84",

  // Status
  statusOrange: "#c4632a",
  statusBlue: "#2a5a8a",
  statusTeal: "#2a6b7a",
  statusGreen: "#2a7a4a",
  statusBrown: "#8b5e3c",
} as const;

export type ColorToken = keyof typeof colors;
