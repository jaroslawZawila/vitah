import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabase } from "@repo/db/vitest";

process.env.NEXTAUTH_SECRET = "test-secret";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    ...testDatabase("vitah_web_test"),
    setupFiles: ["./test/setup.ts"],
  },
});
