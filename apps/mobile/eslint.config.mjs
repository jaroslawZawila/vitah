import { config } from "@repo/eslint-config/react-internal";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    ignores: [".expo/**", "dist/**", "web-build/**", "*.config.js"],
  },
  {
    files: ["__tests__/**"],
    languageOptions: { globals: globals.jest },
  },
];
