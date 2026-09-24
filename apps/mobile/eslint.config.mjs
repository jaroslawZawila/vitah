import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  // CommonJS tooling config and generated Expo files
  { ignores: [".expo/**", "*.config.js"] },
  ...config,
];
